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

# Data source for current AWS account ID
data "aws_caller_identity" "current" {}

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
  aws_region   = var.aws_region
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
    stock_data = {
      path_part = "stock-data"
    }
    stock_screener = {
      path_part = "stock-screener"
    }
    portfolio = {
      path_part = "portfolio"
    }
    dashboard = {
      path_part = "dashboard"
    }
    dashboard_reorder = {
      path_part = "dashboard-reorder"
    }
    dashboard_tiles = {
      path_part = "dashboard-tiles"
    }
    alerts = {
      path_part = "alerts"
    }
    sessions = {
      path_part = "sessions"
    }
    session = {
      path_part = "session"
    }
    news = {
      path_part = "news"
    }
    files = {
      path_part = "files"
    }
    file_download = {
      path_part = "file-download"
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
    # GET method for stock data (comprehensive stock statistics and chart data)
    stock_data_get = {
      resource_key            = "stock_data"
      http_method             = "GET"
      integration_type        = "AWS_PROXY"
      integration_http_method = "POST"
      lambda_arn              = module.stock_data_lambda.function_arn
      request_parameters      = {}
    }
    # POST method for stock screener
    stock_screener_post = {
      resource_key            = "stock_screener"
      http_method             = "POST"
      integration_type        = "AWS_PROXY"
      integration_http_method = "POST"
      lambda_arn              = module.stock_screener_lambda.function_arn
      request_parameters      = {}
      timeout_milliseconds    = 29000 # 29 seconds - max for API Gateway
    }
    # POST method for portfolio analysis (wrapper)
    portfolio_post = {
      resource_key            = "portfolio"
      http_method             = "POST"
      integration_type        = "AWS_PROXY"
      integration_http_method = "POST"
      lambda_arn              = module.portfolio_wrapper_lambda.function_arn
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
    # Dashboard Reorder method
    dashboard_reorder_put = {
      resource_key            = "dashboard_reorder"
      http_method             = "PUT"
      integration_type        = "AWS_PROXY"
      integration_http_method = "POST"
      lambda_arn              = module.user_dashboard_lambda.function_arn
      request_parameters      = {}
    }
    # Dashboard Tiles methods
    tiles_post = {
      resource_key            = "dashboard_tiles"
      http_method             = "POST"
      integration_type        = "AWS_PROXY"
      integration_http_method = "POST"
      lambda_arn              = module.user_dashboard_lambda.function_arn
      request_parameters      = {}
    }
    tiles_delete = {
      resource_key            = "dashboard_tiles"
      http_method             = "DELETE"
      integration_type        = "AWS_PROXY"
      integration_http_method = "POST"
      lambda_arn              = module.user_dashboard_lambda.function_arn
      request_parameters      = {}
    }
    tiles_put = {
      resource_key            = "dashboard_tiles"
      http_method             = "PUT"
      integration_type        = "AWS_PROXY"
      integration_http_method = "POST"
      lambda_arn              = module.user_dashboard_lambda.function_arn
      request_parameters      = {}
    }
    # Session Management methods
    sessions_get = {
      resource_key            = "sessions"
      http_method             = "GET"
      integration_type        = "AWS_PROXY"
      integration_http_method = "POST"
      lambda_arn              = module.session_management_lambda.function_arn
      request_parameters      = {}
    }
    sessions_post = {
      resource_key            = "sessions"
      http_method             = "POST"
      integration_type        = "AWS_PROXY"
      integration_http_method = "POST"
      lambda_arn              = module.session_management_lambda.function_arn
      request_parameters      = {}
    }
    sessions_get_specific = {
      resource_key            = "session"
      http_method             = "GET"
      integration_type        = "AWS_PROXY"
      integration_http_method = "POST"
      lambda_arn              = module.session_management_lambda.function_arn
      request_parameters      = {}
    }
    sessions_put = {
      resource_key            = "session"
      http_method             = "PUT"
      integration_type        = "AWS_PROXY"
      integration_http_method = "POST"
      lambda_arn              = module.session_management_lambda.function_arn
      request_parameters      = {}
    }
    sessions_delete = {
      resource_key            = "session"
      http_method             = "DELETE"
      integration_type        = "AWS_PROXY"
      integration_http_method = "POST"
      lambda_arn              = module.session_management_lambda.function_arn
      request_parameters      = {}
    }
    # POST method for news search
    news_post = {
      resource_key            = "news"
      http_method             = "POST"
      integration_type        = "AWS_PROXY"
      integration_http_method = "POST"
      lambda_arn              = module.news_search_lambda.function_arn
      request_parameters      = {}
    }
    # POST method for file uploads
    files_upload_post = {
      resource_key            = "files"
      http_method             = "POST"
      integration_type        = "AWS_PROXY"
      integration_http_method = "POST"
      lambda_arn              = module.file_upload_lambda.function_arn
      request_parameters      = {}
    }
    # POST method for file downloads (fresh presigned URLs)
    file_download_post = {
      resource_key            = "file_download"
      http_method             = "POST"
      integration_type        = "AWS_PROXY"
      integration_http_method = "POST"
      lambda_arn              = module.file_return_lambda.function_arn
      request_parameters      = {}
    }
    # OPTIONS methods are now automatically created by the API Gateway module
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
    stock_data = {
      function_arn  = module.stock_data_lambda.function_arn
      http_method   = "GET"
      resource_path = "stock-data"
    }
    stock_screener = {
      function_arn  = module.stock_screener_lambda.function_arn
      http_method   = "POST"
      resource_path = "stock-screener"
    }
    portfolio = {
      function_arn  = module.portfolio_wrapper_lambda.function_arn
      http_method   = "POST"
      resource_path = "portfolio"
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
    dashboard_reorder_put = {
      function_arn  = module.user_dashboard_lambda.function_arn
      http_method   = "PUT"
      resource_path = "dashboard-reorder"
    }

    tiles_post = {
      function_arn  = module.user_dashboard_lambda.function_arn
      http_method   = "POST"
      resource_path = "dashboard-tiles"
    }
    tiles_delete = {
      function_arn  = module.user_dashboard_lambda.function_arn
      http_method   = "DELETE"
      resource_path = "dashboard-tiles"
    }
    tiles_put = {
      function_arn  = module.user_dashboard_lambda.function_arn
      http_method   = "PUT"
      resource_path = "dashboard-tiles"
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
    sessions_get = {
      function_arn  = module.session_management_lambda.function_arn
      http_method   = "GET"
      resource_path = "sessions"
    }
    sessions_post = {
      function_arn  = module.session_management_lambda.function_arn
      http_method   = "POST"
      resource_path = "sessions"
    }
    sessions_get_specific = {
      function_arn  = module.session_management_lambda.function_arn
      http_method   = "GET"
      resource_path = "session"
    }
    sessions_put = {
      function_arn  = module.session_management_lambda.function_arn
      http_method   = "PUT"
      resource_path = "session"
    }
    sessions_delete = {
      function_arn  = module.session_management_lambda.function_arn
      http_method   = "DELETE"
      resource_path = "session"
    }
    news_post = {
      function_arn  = module.news_search_lambda.function_arn
      http_method   = "POST"
      resource_path = "news"
    }
    files_upload_post = {
      function_arn  = module.file_upload_lambda.function_arn
      http_method   = "POST"
      resource_path = "files"
    }
    file_download_post = {
      function_arn  = module.file_return_lambda.function_arn
      http_method   = "POST"
      resource_path = "file-download"
    }
  }

  tags = var.common_tags

  # Deployment trigger - increment this when you want to force a redeployment
  deployment_trigger = "39" # Updated to apply CORS configuration for stock-screener endpoint
}

# IAM Policy for Lambda functions to publish to SNS
resource "aws_iam_policy" "lambda_sns_policy" {
  name        = "${var.project_name}-lambda-sns-policy-${var.environment}"
  description = "Policy for Lambda functions to publish to SNS topics"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "sns:Publish"
        ]
        Resource = [
          data.terraform_remote_state.base_infra.outputs.chat_file_upload_notifications_topic_arn
        ]
      }
    ]
  })

  tags = var.common_tags
}

# IAM Policy for Lambda functions to access Secrets Manager
resource "aws_iam_policy" "lambda_secrets_policy" {
  name        = "${var.project_name}-lambda-secrets-policy-${var.environment}"
  description = "Policy for Lambda functions to access Secrets Manager and CloudWatch Logs"

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
          "arn:aws:secretsmanager:*:*:secret:${var.project_name}/*",
          "arn:aws:secretsmanager:*:*:secret:${var.project_name}-alpha-vantage-api-${var.environment}*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:DescribeLogGroups",
          "logs:DescribeLogStreams"
        ]
        Resource = [
          "arn:aws:logs:*:*:*"
        ]
      }
    ]
  })

  tags = var.common_tags
}

# IAM Policy for Lambda functions to access S3 chat files bucket
# Using base infrastructure policy instead of duplicating

# IAM Policy for Lambda functions to invoke other Lambda functions
resource "aws_iam_policy" "lambda_invoke_policy" {
  name        = "${var.project_name}-lambda-invoke-policy-${var.environment}"
  description = "Policy for Lambda functions to invoke other Lambda functions"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "lambda:InvokeFunction"
        ]
        Resource = [
          "arn:aws:lambda:${var.aws_region}:${data.aws_caller_identity.current.account_id}:function:${var.project_name}-*-${var.environment}"
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
          "${data.terraform_remote_state.base_infra.outputs.alerts_table_arn}/index/*",
          data.terraform_remote_state.base_infra.outputs.chat_connections_table_arn,
          "${data.terraform_remote_state.base_infra.outputs.chat_connections_table_arn}/index/*",
          data.terraform_remote_state.base_infra.outputs.chat_sessions_table_arn,
          "${data.terraform_remote_state.base_infra.outputs.chat_sessions_table_arn}/index/*",
          data.terraform_remote_state.base_infra.outputs.news_table_arn,
          "${data.terraform_remote_state.base_infra.outputs.news_table_arn}/index/*"
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
          data.terraform_remote_state.base_infra.outputs.dynamodb_module_kms_key_arn,
          data.terraform_remote_state.base_infra.outputs.kms_key_arn
        ]
      }
    ]
  })

  tags = var.common_tags
}


# IAM Policy for Lambda functions to manage WebSocket connections
resource "aws_iam_policy" "lambda_websocket_policy" {
  name        = "${var.project_name}-lambda-websocket-policy-${var.environment}"
  description = "Policy for Lambda functions to manage WebSocket connections"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "execute-api:ManageConnections"
        ]
        Resource = [
          "${module.websocket_api.api_execution_arn}/*"
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

  # Attach core, numpy, and financial layers
  layers = [
    data.terraform_remote_state.base_infra.outputs.core_layer_arn,
    data.terraform_remote_state.base_infra.outputs.financial_layer_arn
  ]

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

  # Attach core and crypto layers
  layers = [
    data.terraform_remote_state.base_infra.outputs.core_layer_arn,
    data.terraform_remote_state.base_infra.outputs.crypto_layer_arn
  ]

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

  # Attach core layer
  layers = [data.terraform_remote_state.base_infra.outputs.core_layer_arn]

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

  # Attach core layer
  layers = [data.terraform_remote_state.base_infra.outputs.core_layer_arn]

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

  # Attach core layer
  layers = [data.terraform_remote_state.base_infra.outputs.core_layer_arn]

  # Additional IAM policies
  additional_policy_arns = [
    aws_iam_policy.lambda_dynamodb_policy.arn,
    aws_iam_policy.lambda_kms_policy.arn,
    module.ses.lambda_ses_policy_arn
  ]

  tags = var.common_tags
}

# ECR Repository for Chat Agent Container
module "chat_agent_ecr" {
  source = "./modules/ecr"

  project_name = var.project_name
  environment  = var.environment
  kms_key_arn  = data.terraform_remote_state.base_infra.outputs.kms_key_arn
  tags         = var.common_tags

  # Override the repository name for chat agent
  repository_name = "chat-agent"
}

# Chat Agent Lambda Function (Custom deployment with dependencies)
resource "aws_iam_role" "chat_agent_execution_role" {
  name = "${var.project_name}-chat-agent-${var.environment}-execution-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })

  tags = var.common_tags
}

# Basic execution policy attachment
resource "aws_iam_role_policy_attachment" "chat_agent_basic_execution" {
  role       = aws_iam_role.chat_agent_execution_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Attach additional IAM policies
resource "aws_iam_role_policy_attachment" "chat_agent_secrets_policy" {
  role       = aws_iam_role.chat_agent_execution_role.name
  policy_arn = aws_iam_policy.lambda_secrets_policy.arn
}

# Attach S3 policy for chat files access
resource "aws_iam_role_policy_attachment" "chat_agent_s3_policy" {
  role       = aws_iam_role.chat_agent_execution_role.name
  policy_arn = data.terraform_remote_state.base_infra.outputs.lambda_s3_chat_files_policy_arn
}

# ECR policy for container image access
resource "aws_iam_policy" "lambda_ecr_policy" {
  name        = "${var.project_name}-lambda-ecr-policy-${var.environment}"
  description = "Policy for Lambda functions to access ECR repositories"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ecr:GetAuthorizationToken"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage"
        ]
        Resource = module.chat_agent_ecr.repository_arn
      }
    ]
  })

  tags = var.common_tags
}

# Attach ECR policy for container image access
resource "aws_iam_role_policy_attachment" "chat_agent_ecr_policy" {
  role       = aws_iam_role.chat_agent_execution_role.name
  policy_arn = aws_iam_policy.lambda_ecr_policy.arn
}

# Attach DynamoDB policy for chat agent
resource "aws_iam_role_policy_attachment" "chat_agent_dynamodb_policy" {
  role       = aws_iam_role.chat_agent_execution_role.name
  policy_arn = aws_iam_policy.lambda_dynamodb_policy.arn
}

# Attach KMS policy for DynamoDB encryption
resource "aws_iam_role_policy_attachment" "chat_agent_kms_policy" {
  role       = aws_iam_role.chat_agent_execution_role.name
  policy_arn = aws_iam_policy.lambda_kms_policy.arn
}

# Attach Lambda invoke policy for file return service
resource "aws_iam_role_policy_attachment" "chat_agent_lambda_invoke_policy" {
  role       = aws_iam_role.chat_agent_execution_role.name
  policy_arn = aws_iam_policy.lambda_invoke_policy.arn
}


# Bedrock policy for chat agent
resource "aws_iam_role_policy" "chat_agent_bedrock_policy" {
  name = "${var.project_name}-chat-agent-bedrock-policy-${var.environment}"
  role = aws_iam_role.chat_agent_execution_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream",
          "bedrock:InvokeModelCrossRegion",
          "bedrock:InvokeModelWithResponseStreamCrossRegion"
        ]
        Resource = [
          # Foundation models (US-specific model IDs) - Cross-region inference enabled
          "arn:aws:bedrock:*:*:foundation-model/us.anthropic.claude-opus-4-1-20250805-v1:0",
          "arn:aws:bedrock:*:*:foundation-model/us.anthropic.claude-haiku-4-5-20251001-v1:0",
          "arn:aws:bedrock:*:*:foundation-model/us.amazon.nova-lite-v1:0",
          "arn:aws:bedrock:*:*:foundation-model/openai.gpt-oss-120b-1:0",
          "arn:aws:bedrock:*:*:foundation-model/openai.gpt-oss-20b-1:0",
          # Foundation models (legacy model IDs) - Fallback support
          "arn:aws:bedrock:*:*:foundation-model/anthropic.claude-opus-4-1-20250805-v1:0",
          "arn:aws:bedrock:*:*:foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0",
          "arn:aws:bedrock:*:*:foundation-model/anthropic.claude-3-haiku-20240307-v1:0",
          "arn:aws:bedrock:*:*:foundation-model/amazon.nova-lite-v1:0",
          # Inference profiles for cross-region inference
          "arn:aws:bedrock:*:*:inference-profile/us.anthropic.claude-opus-4-1-20250805-v1:0",
          "arn:aws:bedrock:*:*:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0",
          "arn:aws:bedrock:*:*:inference-profile/us.amazon.nova-lite-v1:0",
          "arn:aws:bedrock:*:*:inference-profile/openai.gpt-oss-120b-1:0",
          "arn:aws:bedrock:*:*:inference-profile/openai.gpt-oss-20b-1:0",
          # Inference profiles (legacy model IDs) - Fallback support
          "arn:aws:bedrock:*:*:inference-profile/anthropic.claude-opus-4-1-20250805-v1:0",
          "arn:aws:bedrock:*:*:inference-profile/anthropic.claude-haiku-4-5-20251001-v1:0",
          "arn:aws:bedrock:*:*:inference-profile/anthropic.claude-3-haiku-20240307-v1:0",
          "arn:aws:bedrock:*:*:inference-profile/amazon.nova-lite-v1:0"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "bedrock:GetFoundationModel",
          "bedrock:ListFoundationModels"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "aws-marketplace:ViewSubscriptions",
          "aws-marketplace:Subscribe"
        ]
        Resource = "*"
      }
    ]
  })
}

# Chat Agent Lambda Function (Container-based)
resource "aws_lambda_function" "chat_agent" {
  function_name = "${var.project_name}-chat-agent-${var.environment}"
  description   = "Lambda function for chat agent with financial analysis capabilities - Container-based deployment - Trigger: ${var.chat_agent_deployment_trigger} - Image: ${var.chat_agent_image_uri != "" ? var.chat_agent_image_uri : "${module.chat_agent_ecr.repository_url}:${var.chat_agent_image_tag}"}"
  role          = aws_iam_role.chat_agent_execution_role.arn
  timeout       = 300
  memory_size   = 1024 # Memory for chat agent processing

  # Container-based deployment
  package_type = "Image"
  image_uri    = var.chat_agent_image_uri != "" ? var.chat_agent_image_uri : "${module.chat_agent_ecr.repository_url}:${var.chat_agent_image_tag}"

  # Force redeployment when image changes
  lifecycle {
    create_before_destroy = true
  }

  # Force Lambda function replacement when image URI changes
  # replace_triggered_by = [
  #   var.chat_agent_image_uri
  # ]

  environment {
    variables = {
      ENVIRONMENT                 = var.environment
      LOG_LEVEL                   = var.environment == "development" ? "DEBUG" : "INFO"
      DEPLOYMENT_TIMESTAMP        = timestamp()
      IMAGE_URI                   = var.chat_agent_image_uri != "" ? var.chat_agent_image_uri : "${module.chat_agent_ecr.repository_url}:${var.chat_agent_image_tag}"
      DEPLOYMENT_HASH             = substr(md5(var.chat_agent_image_uri != "" ? var.chat_agent_image_uri : "${module.chat_agent_ecr.repository_url}:${var.chat_agent_image_tag}"), 0, 8)
      USER_PROFILES_TABLE_NAME    = data.terraform_remote_state.base_infra.outputs.user_profiles_table_name
      ALERTS_TABLE_NAME           = data.terraform_remote_state.base_infra.outputs.alerts_table_name
      CHAT_CONNECTIONS_TABLE_NAME = data.terraform_remote_state.base_infra.outputs.chat_connections_table_name
      CHAT_SESSIONS_TABLE_NAME    = data.terraform_remote_state.base_infra.outputs.chat_sessions_table_name

      # Session Management Configuration - using consolidated chat_sessions table
      SESSIONS_TABLE_NAME        = data.terraform_remote_state.base_infra.outputs.chat_sessions_table_name
      SESSION_CONTEXT_TABLE_NAME = data.terraform_remote_state.base_infra.outputs.chat_sessions_table_name
      SESSION_ARCHIVES_BUCKET    = "" # Not configured - using DynamoDB TTL instead
      SESSION_TTL_DAYS           = "30"
      CONTEXT_TTL_DAYS           = "30"
      MAX_CONTEXT_SIZE           = "100000"

      # S3 Configuration for file uploads
      CHAT_FILES_BUCKET_NAME = data.terraform_remote_state.base_infra.outputs.chat_files_bucket_name

      # File Return Lambda Function Name for direct invocation
      FILE_RETURN_LAMBDA_NAME = module.file_return_lambda.function_name
    }
  }

  tags = var.common_tags

  # Force update when layer changes
  depends_on = [data.terraform_remote_state.base_infra]
}

# Note: Provisioned concurrency removed for now due to complexity with $LATEST
# Can be added later using AWS CLI or console after Lambda is deployed

# WebSocket Connection Manager Lambda Function
module "websocket_connection_lambda" {
  source = "./modules/lambda"

  function_name = "${var.project_name}-websocket-connection-${var.environment}"
  description   = "Lambda function for WebSocket connection management"
  handler       = "lambda_function.lambda_handler"
  runtime       = "python3.11"
  timeout       = 30
  memory_size   = 256

  # Source directory
  source_dir = "../backend_app/src/websocket/connection_manager/app"

  # Environment variables
  environment_variables = {
    CHAT_CONNECTIONS_TABLE_NAME = data.terraform_remote_state.base_infra.outputs.chat_connections_table_name
    CHAT_SESSIONS_TABLE_NAME    = data.terraform_remote_state.base_infra.outputs.chat_sessions_table_name
    WEBSOCKET_ENDPOINT          = module.websocket_api.stage_url
    WEBSOCKET_API_ID            = module.websocket_api.api_id
    ENVIRONMENT                 = var.environment
    LOG_LEVEL                   = var.environment == "development" ? "DEBUG" : "INFO"
  }

  # Attach core layer
  layers = [data.terraform_remote_state.base_infra.outputs.core_layer_arn]

  # Additional IAM policies
  additional_policy_arns = [
    aws_iam_policy.lambda_dynamodb_policy.arn,
    aws_iam_policy.lambda_kms_policy.arn,
    aws_iam_policy.lambda_websocket_policy.arn
  ]

  tags = var.common_tags
}

# WebSocket Message Processor Lambda Function
module "websocket_message_lambda" {
  source = "./modules/lambda"

  function_name = "${var.project_name}-websocket-message-${var.environment}"
  description   = "Lambda function for WebSocket message processing"
  handler       = "lambda_function.lambda_handler"
  runtime       = "python3.11"
  timeout       = 120
  memory_size   = 512

  # Source directory
  source_dir = "../backend_app/src/websocket/message_processor/app"

  # Environment variables
  environment_variables = {
    CHAT_CONNECTIONS_TABLE_NAME = data.terraform_remote_state.base_infra.outputs.chat_connections_table_name
    CHAT_SESSIONS_TABLE_NAME    = data.terraform_remote_state.base_infra.outputs.chat_sessions_table_name
    CHAT_AGENT_FUNCTION_NAME    = "${var.project_name}-chat-agent-${var.environment}"
    WEBSOCKET_ENDPOINT          = module.websocket_api.stage_url
    WEBSOCKET_API_ID            = module.websocket_api.api_id
    CHAT_FILES_BUCKET_NAME      = data.terraform_remote_state.base_infra.outputs.chat_files_bucket_name
    ENVIRONMENT                 = var.environment
    LOG_LEVEL                   = var.environment == "development" ? "DEBUG" : "INFO"
  }

  # Attach core layer
  layers = [data.terraform_remote_state.base_infra.outputs.core_layer_arn]

  # Additional IAM policies
  additional_policy_arns = [
    aws_iam_policy.lambda_dynamodb_policy.arn,
    aws_iam_policy.lambda_kms_policy.arn,
    aws_iam_policy.lambda_invoke_policy.arn,
    aws_iam_policy.lambda_websocket_policy.arn
  ]

  tags = var.common_tags
}

# WebSocket API Gateway
module "websocket_api" {
  source = "./modules/websocket-api"

  api_name        = "${var.project_name}-websocket-api-${var.environment}"
  api_description = "WebSocket API for real-time chat functionality"
  stage_name      = var.environment

  connection_lambda_arn  = module.websocket_connection_lambda.function_arn
  connection_lambda_name = module.websocket_connection_lambda.function_name
  message_lambda_arn     = module.websocket_message_lambda.function_arn
  message_lambda_name    = module.websocket_message_lambda.function_name

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

# Portfolio Analysis Lambda Function (Internal - no API Gateway)
module "portfolio_analysis_lambda" {
  source = "./modules/lambda"

  function_name = "${var.project_name}-portfolio-analysis-${var.environment}"
  description   = "Lambda function for portfolio risk analysis and metrics calculation"
  handler       = "lambda_function.lambda_handler"
  runtime       = "python3.11"
  timeout       = 60
  memory_size   = 1024

  # Source directory
  source_dir = "../backend_app/src/stocks/stock_statistics/app"

  # Environment variables
  environment_variables = {
    ENVIRONMENT = var.environment
    LOG_LEVEL   = var.environment == "development" ? "DEBUG" : "INFO"
  }

  # Attach core and financial layers
  layers = [
    data.terraform_remote_state.base_infra.outputs.core_layer_arn,
    data.terraform_remote_state.base_infra.outputs.financial_layer_arn
  ]

  # Additional IAM policies
  additional_policy_arns = [
    aws_iam_policy.lambda_secrets_policy.arn
  ]

  tags = var.common_tags
}

# Portfolio Wrapper Lambda Function (Frontend API)
module "portfolio_wrapper_lambda" {
  source = "./modules/lambda"

  function_name = "${var.project_name}-portfolio-wrapper-${var.environment}"
  description   = "Lambda function wrapper for frontend portfolio analysis requests"
  handler       = "lambda_function.lambda_handler"
  runtime       = "python3.11"
  timeout       = 30
  memory_size   = 512

  # Source directory
  source_dir = "../backend_app/src/stocks/portfolio_wrapper/app"

  # Environment variables
  environment_variables = {
    ENVIRONMENT                      = var.environment
    LOG_LEVEL                        = var.environment == "development" ? "DEBUG" : "INFO"
    PORTFOLIO_ANALYSIS_FUNCTION_NAME = module.portfolio_analysis_lambda.function_name
  }

  # Attach core layer only
  layers = [
    data.terraform_remote_state.base_infra.outputs.core_layer_arn
  ]

  # Additional IAM policies for Lambda invocation
  additional_policy_arns = [
    aws_iam_policy.lambda_invoke_policy.arn
  ]

  tags = var.common_tags
}

# Stock Screener Lambda Function
module "stock_screener_lambda" {
  source = "./modules/lambda"

  function_name = "${var.project_name}-stock-screener-${var.environment}"
  description   = "Lambda function for stock screening using yfinance and Alpha Vantage"
  handler       = "lambda_function.lambda_handler"
  runtime       = "python3.11"
  timeout       = 300  # 5 minutes for bulk screening operations
  memory_size   = 1024 # Increased memory for parallel processing

  # Source directory
  source_dir = "../backend_app/src/stocks/stock_screener/app"

  # Environment variables
  environment_variables = {
    ENVIRONMENT           = var.environment
    LOG_LEVEL             = var.environment == "development" ? "DEBUG" : "INFO"
    STOCK_DATA_TABLE_NAME = data.terraform_remote_state.base_infra.outputs.stock_data_table_name
  }

  # Attach core and financial layers
  layers = [
    data.terraform_remote_state.base_infra.outputs.core_layer_arn,
    data.terraform_remote_state.base_infra.outputs.financial_layer_arn
  ]

  # Additional IAM policies
  additional_policy_arns = [
    aws_iam_policy.lambda_secrets_policy.arn,
    aws_iam_policy.lambda_kms_policy.arn,
    data.terraform_remote_state.base_infra.outputs.stock_data_table_policy_arn
  ]

  tags = var.common_tags
}

# Stock Data Lambda Function
module "stock_data_lambda" {
  source = "./modules/lambda"

  function_name = "${var.project_name}-stock-data-${var.environment}"
  description   = "Lambda function for comprehensive stock data retrieval using yfinance"
  handler       = "lambda_function.lambda_handler"
  runtime       = "python3.11"
  timeout       = 60
  memory_size   = 512

  # Source directory
  source_dir = "../backend_app/src/stocks/stock_data/app"

  # Environment variables
  environment_variables = {
    ENVIRONMENT = var.environment
    LOG_LEVEL   = var.environment == "development" ? "DEBUG" : "INFO"
  }

  # Attach core and financial layers
  layers = [
    data.terraform_remote_state.base_infra.outputs.core_layer_arn,
    data.terraform_remote_state.base_infra.outputs.financial_layer_arn
  ]

  # Additional IAM policies
  additional_policy_arns = [
    aws_iam_policy.lambda_dynamodb_policy.arn,
    aws_iam_policy.lambda_kms_policy.arn,
    aws_iam_policy.lambda_secrets_policy.arn
  ]

  tags = var.common_tags
}

# Stock Statistics Lambda Function (Updated to use financial layer)
module "stock_statistics_lambda" {
  source = "./modules/lambda"

  function_name = "${var.project_name}-stock-statistics-${var.environment}"
  description   = "Lambda function for portfolio analysis and stock statistics using yfinance"
  handler       = "lambda_function.lambda_function"
  runtime       = "python3.11"
  timeout       = 60
  memory_size   = 512

  # Source directory
  source_dir = "../backend_app/src/stocks/stock_statistics/app"

  # Environment variables
  environment_variables = {
    ENVIRONMENT = var.environment
    LOG_LEVEL   = var.environment == "development" ? "DEBUG" : "INFO"
  }

  # Attach core and financial layers
  layers = [
    data.terraform_remote_state.base_infra.outputs.core_layer_arn,
    data.terraform_remote_state.base_infra.outputs.financial_layer_arn
  ]

  # Additional IAM policies
  additional_policy_arns = [
    aws_iam_policy.lambda_dynamodb_policy.arn,
    aws_iam_policy.lambda_kms_policy.arn
  ]

  tags = var.common_tags
}

# Volatility Fetch Lambda Function (Updated to use financial layer)
module "volatility_fetch_lambda" {
  source = "./modules/lambda"

  function_name = "${var.project_name}-volatility-fetch-${var.environment}"
  description   = "Lambda function for stock volatility calculation using yfinance"
  handler       = "lambda_function.lambda_handler"
  runtime       = "python3.11"
  timeout       = 30
  memory_size   = 256

  # Source directory
  source_dir = "../backend_app/src/stocks/volatility_fetch/app"

  # Environment variables
  environment_variables = {
    ENVIRONMENT = var.environment
    LOG_LEVEL   = var.environment == "development" ? "DEBUG" : "INFO"
  }

  # Attach core and financial layers
  layers = [
    data.terraform_remote_state.base_infra.outputs.core_layer_arn,
    data.terraform_remote_state.base_infra.outputs.financial_layer_arn
  ]

  # Additional IAM policies
  additional_policy_arns = [
    aws_iam_policy.lambda_dynamodb_policy.arn,
    aws_iam_policy.lambda_kms_policy.arn
  ]

  tags = var.common_tags
}

# Robinhood Integration Lambda Function
module "robinhood_integration_lambda" {
  source = "./modules/lambda"

  function_name = "${var.project_name}-robinhood-integration-${var.environment}"
  description   = "Lambda function for Robinhood API integration and portfolio analysis"
  handler       = "lambda_function.lambda_handler"
  runtime       = "python3.11"
  timeout       = 60
  memory_size   = 512

  # Source directory
  source_dir = "../backend_app/src/stocks/robinhood_integration/app"

  # Environment variables
  environment_variables = {
    ENVIRONMENT                      = var.environment
    LOG_LEVEL                        = var.environment == "development" ? "DEBUG" : "INFO"
    PORTFOLIO_ANALYSIS_FUNCTION_NAME = module.portfolio_analysis_lambda.function_name
  }

  # Attach core and financial layers
  layers = [
    data.terraform_remote_state.base_infra.outputs.core_layer_arn,
    data.terraform_remote_state.base_infra.outputs.financial_layer_arn
  ]

  # Additional IAM policies
  additional_policy_arns = [
    aws_iam_policy.lambda_dynamodb_policy.arn,
    aws_iam_policy.lambda_kms_policy.arn,
    aws_iam_policy.lambda_invoke_policy.arn
  ]

  tags = var.common_tags
}

# Session Management Lambda Function
module "session_management_lambda" {
  source = "./modules/lambda"

  function_name = "${var.project_name}-session-management-${var.environment}"
  description   = "Lambda function for managing chat sessions and message persistence"
  handler       = "lambda_function.lambda_handler"
  runtime       = "python3.11"
  timeout       = 30
  memory_size   = 256

  source_dir = "../backend_app/src/session_management/app"

  environment_variables = {
    CHAT_SESSIONS_TABLE_NAME = data.terraform_remote_state.base_infra.outputs.chat_sessions_table_name
  }

  additional_policy_arns = [
    aws_iam_policy.lambda_dynamodb_policy.arn,
    aws_iam_policy.lambda_kms_policy.arn,
    aws_iam_policy.lambda_invoke_policy.arn,
    data.terraform_remote_state.base_infra.outputs.lambda_s3_chat_files_policy_arn
  ]

  tags = var.common_tags
}

# File Return Lambda Function
module "file_return_lambda" {
  source = "./modules/lambda"

  function_name = "${var.project_name}-file-return-${var.environment}"
  description   = "Lambda function for secure file returns with user validation"
  handler       = "lambda_function.lambda_handler"
  runtime       = "python3.11"
  timeout       = 30
  memory_size   = 256

  source_dir = "../backend_app/src/file_return/app"

  environment_variables = {
    S3_BUCKET          = data.terraform_remote_state.base_infra.outputs.chat_files_bucket_name
    SESSIONS_TABLE     = data.terraform_remote_state.base_infra.outputs.chat_sessions_table_name
    WEBSOCKET_ENDPOINT = module.websocket_api.stage_url
    ENVIRONMENT        = var.environment
    LOG_LEVEL          = var.environment == "development" ? "DEBUG" : "INFO"
  }

  additional_policy_arns = [
    aws_iam_policy.lambda_dynamodb_policy.arn,
    data.terraform_remote_state.base_infra.outputs.lambda_s3_chat_files_policy_arn,
    aws_iam_policy.lambda_websocket_policy.arn,
    data.terraform_remote_state.base_infra.outputs.kms_access_policy_arn
  ]

  tags = var.common_tags

  depends_on = [module.websocket_api]
}

# News Search Lambda Function
module "news_search_lambda" {
  source = "./modules/lambda"

  function_name = "${var.project_name}-news-search-${var.environment}"
  description   = "Lambda function for news search with complex query expressions"
  handler       = "lambda_function.lambda_handler"
  runtime       = "python3.11"
  timeout       = 30
  memory_size   = 512

  source_dir = "../backend_app/src/news_search/app"

  environment_variables = {
    NEWS_TABLE_NAME = data.terraform_remote_state.base_infra.outputs.news_table_name
    ENVIRONMENT     = var.environment
    LOG_LEVEL       = var.environment == "development" ? "DEBUG" : "INFO"
  }

  # Attach core layer
  layers = [data.terraform_remote_state.base_infra.outputs.core_layer_arn]

  additional_policy_arns = [
    aws_iam_policy.lambda_dynamodb_policy.arn,
    aws_iam_policy.lambda_kms_policy.arn
  ]

  tags = var.common_tags
}

# File Upload Lambda Function
module "file_upload_lambda" {
  source = "./modules/lambda"

  function_name = "${var.project_name}-file-upload-${var.environment}"
  description   = "Lambda function for handling file uploads to S3"
  handler       = "lambda_function.lambda_handler"
  runtime       = "python3.11"
  timeout       = 30
  memory_size   = 512

  # Source directory
  source_dir = "../backend_app/src/file_upload/app"

  # Environment variables
  environment_variables = {
    ENVIRONMENT                       = var.environment
    LOG_LEVEL                         = var.environment == "development" ? "DEBUG" : "INFO"
    CHAT_FILES_BUCKET_NAME            = data.terraform_remote_state.base_infra.outputs.chat_files_bucket_name
    CHAT_SESSIONS_TABLE_NAME          = data.terraform_remote_state.base_infra.outputs.chat_sessions_table_name
    SNS_TOPIC_ARN                     = data.terraform_remote_state.base_infra.outputs.chat_file_upload_notifications_topic_arn
    WEBSOCKET_PROCESSOR_FUNCTION_NAME = module.websocket_message_lambda.function_name
  }

  # Attach core layer
  layers = [data.terraform_remote_state.base_infra.outputs.core_layer_arn]

  # Additional IAM policies
  additional_policy_arns = [
    aws_iam_policy.lambda_dynamodb_policy.arn,
    aws_iam_policy.lambda_kms_policy.arn,
    aws_iam_policy.lambda_invoke_policy.arn,
    aws_iam_policy.lambda_sns_policy.arn,
    data.terraform_remote_state.base_infra.outputs.lambda_s3_chat_files_policy_arn
  ]

  tags = var.common_tags
}

# Agent Files Processor Lambda Function
module "agent_files_processor_lambda" {
  source = "./modules/lambda"

  function_name = "${var.project_name}-agent-files-processor-${var.environment}"
  description   = "Lambda function for processing agent files and updating session_variables"
  handler       = "lambda_function.lambda_handler"
  runtime       = "python3.11"
  timeout       = 30
  memory_size   = 512

  # Source directory
  source_dir = "../backend_app/src/agent_files_processor/app"

  # Environment variables
  environment_variables = {
    ENVIRONMENT                       = var.environment
    LOG_LEVEL                         = var.environment == "development" ? "DEBUG" : "INFO"
    CHAT_FILES_BUCKET_NAME            = data.terraform_remote_state.base_infra.outputs.chat_files_bucket_name
    CHAT_SESSIONS_TABLE_NAME          = data.terraform_remote_state.base_infra.outputs.chat_sessions_table_name
    WEBSOCKET_PROCESSOR_FUNCTION_NAME = module.websocket_message_lambda.function_name
  }

  # Attach core layer
  layers = [data.terraform_remote_state.base_infra.outputs.core_layer_arn]

  # Additional IAM policies
  additional_policy_arns = [
    aws_iam_policy.lambda_dynamodb_policy.arn,
    aws_iam_policy.lambda_kms_policy.arn,
    aws_iam_policy.lambda_invoke_policy.arn,
    data.terraform_remote_state.base_infra.outputs.lambda_s3_chat_files_policy_arn
  ]

  tags = var.common_tags
}

# SNS Permission for Agent Files Processor Lambda
resource "aws_lambda_permission" "agent_files_processor_sns" {
  statement_id  = "AllowExecutionFromSNS"
  action        = "lambda:InvokeFunction"
  function_name = module.agent_files_processor_lambda.function_name
  principal     = "sns.amazonaws.com"
  source_arn    = data.terraform_remote_state.base_infra.outputs.agent_file_upload_notifications_topic_arn
}

# SNS Subscription for Agent Files Processor Lambda
resource "aws_sns_topic_subscription" "agent_files_processor" {
  topic_arn = data.terraform_remote_state.base_infra.outputs.agent_file_upload_notifications_topic_arn
  protocol  = "lambda"
  endpoint  = module.agent_files_processor_lambda.function_arn
}