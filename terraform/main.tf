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
    dashboard_share = {
      path_part = "dashboard-share"
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
    filesystem = {
      path_part = "filesystem"
    }
    file_download = {
      path_part = "file-download"
    }
    sec_search = {
      path_part = "sec-search"
    }
    sec_search_autocomplete = {
      path_part = "sec-search-autocomplete"
    }
    sec_search_status = {
      path_part = "sec-search-status"
    }
    sec_search_cancel = {
      path_part = "sec-search-cancel"
    }
    sec_search_results = {
      path_part = "sec-search-results"
    }
    politician_trades_search = {
      path_part = "politician-trades-search"
    }
    usaspending_autocomplete = {
      path_part = "usaspending-autocomplete"
    }
    usaspending_search = {
      path_part = "usaspending-search"
    }
    usaspending_enrichment = {
      path_part = "usaspending-enrichment"
    }
    congress_bills_search = {
      path_part = "congress-bills-search"
    }
    lda_search = {
      path_part = "lda-search"
    }
    lda_autocomplete = {
      path_part = "lda-autocomplete"
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
      lambda_arn              = module.stock_volatility_lambda.wrapper_function_arn != null ? module.stock_volatility_lambda.wrapper_function_arn : module.stock_volatility_lambda.function_arn
      request_parameters      = {}
    }
    # GET method for crypto stats
    crypto_get = {
      resource_key            = "crypto"
      http_method             = "GET"
      integration_type        = "AWS_PROXY"
      integration_http_method = "POST"
      lambda_arn              = module.crypto_stats_lambda.wrapper_function_arn != null ? module.crypto_stats_lambda.wrapper_function_arn : module.crypto_stats_lambda.function_arn
      request_parameters      = {}
    }
    # GET method for stock data (comprehensive stock statistics and chart data)
    stock_data_get = {
      resource_key            = "stock_data"
      http_method             = "GET"
      integration_type        = "AWS_PROXY"
      integration_http_method = "POST"
      lambda_arn              = module.stock_data_lambda.wrapper_function_arn != null ? module.stock_data_lambda.wrapper_function_arn : module.stock_data_lambda.function_arn
      request_parameters      = {}
    }
    # POST method for stock screener
    stock_screener_post = {
      resource_key            = "stock_screener"
      http_method             = "POST"
      integration_type        = "AWS_PROXY"
      integration_http_method = "POST"
      lambda_arn              = module.stock_screener_lambda.wrapper_function_arn != null ? module.stock_screener_lambda.wrapper_function_arn : module.stock_screener_lambda.function_arn
      request_parameters      = {}
      timeout_milliseconds    = 29000 # 29 seconds - max for API Gateway
    }
    # POST method for portfolio analysis (wrapper)
    portfolio_post = {
      resource_key            = "portfolio"
      http_method             = "POST"
      integration_type        = "AWS_PROXY"
      integration_http_method = "POST"
      lambda_arn              = module.portfolio_analysis_lambda.wrapper_function_arn != null ? module.portfolio_analysis_lambda.wrapper_function_arn : module.portfolio_analysis_lambda.function_arn
      request_parameters      = {}
    }
    # GET method for alerts (fetch user alerts)
    alerts_get = {
      resource_key            = "alerts"
      http_method             = "GET"
      integration_type        = "AWS_PROXY"
      integration_http_method = "POST"
      lambda_arn              = module.stock_alerts_lambda.wrapper_function_arn != null ? module.stock_alerts_lambda.wrapper_function_arn : module.stock_alerts_lambda.function_arn
      request_parameters      = {}
    }
    # POST method for alerts (create new alert)
    alerts_post = {
      resource_key            = "alerts"
      http_method             = "POST"
      integration_type        = "AWS_PROXY"
      integration_http_method = "POST"
      lambda_arn              = module.stock_alerts_lambda.wrapper_function_arn != null ? module.stock_alerts_lambda.wrapper_function_arn : module.stock_alerts_lambda.function_arn
      request_parameters      = {}
    }
    # DELETE method for alerts (delete specific alert)
    alerts_delete = {
      resource_key            = "alerts"
      http_method             = "DELETE"
      integration_type        = "AWS_PROXY"
      integration_http_method = "POST"
      lambda_arn              = module.stock_alerts_lambda.wrapper_function_arn != null ? module.stock_alerts_lambda.wrapper_function_arn : module.stock_alerts_lambda.function_arn
      request_parameters      = {}
    }
    # User Dashboard methods
    dashboard_get = {
      resource_key            = "dashboard"
      http_method             = "GET"
      integration_type        = "AWS_PROXY"
      integration_http_method = "POST"
      lambda_arn              = module.user_dashboard_lambda.wrapper_function_arn != null ? module.user_dashboard_lambda.wrapper_function_arn : module.user_dashboard_lambda.function_arn
      request_parameters      = {}
      timeout_milliseconds    = 29000 # 29 seconds - max for API Gateway
    }
    dashboard_put = {
      resource_key            = "dashboard"
      http_method             = "PUT"
      integration_type        = "AWS_PROXY"
      integration_http_method = "POST"
      lambda_arn              = module.user_dashboard_lambda.wrapper_function_arn != null ? module.user_dashboard_lambda.wrapper_function_arn : module.user_dashboard_lambda.function_arn
      request_parameters      = {}
      timeout_milliseconds    = 29000 # 29 seconds - max for API Gateway
    }
    dashboard_post = {
      resource_key            = "dashboard"
      http_method             = "POST"
      integration_type        = "AWS_PROXY"
      integration_http_method = "POST"
      lambda_arn              = module.user_dashboard_lambda.wrapper_function_arn != null ? module.user_dashboard_lambda.wrapper_function_arn : module.user_dashboard_lambda.function_arn
      request_parameters      = {}
      timeout_milliseconds    = 29000 # 29 seconds - max for API Gateway
    }
    dashboard_delete = {
      resource_key            = "dashboard"
      http_method             = "DELETE"
      integration_type        = "AWS_PROXY"
      integration_http_method = "POST"
      lambda_arn              = module.user_dashboard_lambda.wrapper_function_arn != null ? module.user_dashboard_lambda.wrapper_function_arn : module.user_dashboard_lambda.function_arn
      request_parameters      = {}
      timeout_milliseconds    = 29000 # 29 seconds - max for API Gateway
    }
    # Dashboard Reorder method
    dashboard_reorder_put = {
      resource_key            = "dashboard_reorder"
      http_method             = "PUT"
      integration_type        = "AWS_PROXY"
      integration_http_method = "POST"
      lambda_arn              = module.user_dashboard_lambda.wrapper_function_arn != null ? module.user_dashboard_lambda.wrapper_function_arn : module.user_dashboard_lambda.function_arn
      request_parameters      = {}
      timeout_milliseconds    = 29000 # 29 seconds - max for API Gateway
    }
    # Dashboard Tiles methods
    tiles_post = {
      resource_key            = "dashboard_tiles"
      http_method             = "POST"
      integration_type        = "AWS_PROXY"
      integration_http_method = "POST"
      lambda_arn              = module.user_dashboard_lambda.wrapper_function_arn != null ? module.user_dashboard_lambda.wrapper_function_arn : module.user_dashboard_lambda.function_arn
      request_parameters      = {}
      timeout_milliseconds    = 29000 # 29 seconds - max for API Gateway
    }
    tiles_delete = {
      resource_key            = "dashboard_tiles"
      http_method             = "DELETE"
      integration_type        = "AWS_PROXY"
      integration_http_method = "POST"
      lambda_arn              = module.user_dashboard_lambda.wrapper_function_arn != null ? module.user_dashboard_lambda.wrapper_function_arn : module.user_dashboard_lambda.function_arn
      request_parameters      = {}
      timeout_milliseconds    = 29000 # 29 seconds - max for API Gateway
    }
    tiles_put = {
      resource_key            = "dashboard_tiles"
      http_method             = "PUT"
      integration_type        = "AWS_PROXY"
      integration_http_method = "POST"
      lambda_arn              = module.user_dashboard_lambda.wrapper_function_arn != null ? module.user_dashboard_lambda.wrapper_function_arn : module.user_dashboard_lambda.function_arn
      request_parameters      = {}
      timeout_milliseconds    = 29000 # 29 seconds - max for API Gateway
    }
    # Dashboard Share method
    dashboard_share_post = {
      resource_key            = "dashboard_share"
      http_method             = "POST"
      integration_type        = "AWS_PROXY"
      integration_http_method = "POST"
      lambda_arn              = module.user_dashboard_lambda.wrapper_function_arn != null ? module.user_dashboard_lambda.wrapper_function_arn : module.user_dashboard_lambda.function_arn
      request_parameters      = {}
      timeout_milliseconds    = 29000 # 29 seconds - max for API Gateway
    }
    # Session Management methods
    sessions_get = {
      resource_key            = "sessions"
      http_method             = "GET"
      integration_type        = "AWS_PROXY"
      integration_http_method = "POST"
      lambda_arn              = module.session_management_lambda.wrapper_function_arn != null ? module.session_management_lambda.wrapper_function_arn : module.session_management_lambda.function_arn
      request_parameters      = {}
    }
    sessions_post = {
      resource_key            = "sessions"
      http_method             = "POST"
      integration_type        = "AWS_PROXY"
      integration_http_method = "POST"
      lambda_arn              = module.session_management_lambda.wrapper_function_arn != null ? module.session_management_lambda.wrapper_function_arn : module.session_management_lambda.function_arn
      request_parameters      = {}
    }
    sessions_get_specific = {
      resource_key            = "session"
      http_method             = "GET"
      integration_type        = "AWS_PROXY"
      integration_http_method = "POST"
      lambda_arn              = module.session_management_lambda.wrapper_function_arn != null ? module.session_management_lambda.wrapper_function_arn : module.session_management_lambda.function_arn
      request_parameters      = {}
    }
    sessions_put = {
      resource_key            = "session"
      http_method             = "PUT"
      integration_type        = "AWS_PROXY"
      integration_http_method = "POST"
      lambda_arn              = module.session_management_lambda.wrapper_function_arn != null ? module.session_management_lambda.wrapper_function_arn : module.session_management_lambda.function_arn
      request_parameters      = {}
    }
    sessions_delete = {
      resource_key            = "session"
      http_method             = "DELETE"
      integration_type        = "AWS_PROXY"
      integration_http_method = "POST"
      lambda_arn              = module.session_management_lambda.wrapper_function_arn != null ? module.session_management_lambda.wrapper_function_arn : module.session_management_lambda.function_arn
      request_parameters      = {}
    }
    # POST method for news search
    news_post = {
      resource_key            = "news"
      http_method             = "POST"
      integration_type        = "AWS_PROXY"
      integration_http_method = "POST"
      lambda_arn              = module.news_search_lambda.wrapper_function_arn != null ? module.news_search_lambda.wrapper_function_arn : module.news_search_lambda.function_arn
      request_parameters      = {}
      timeout_milliseconds    = 29000 # 29 seconds - max for API Gateway
    }
    # POST method for file uploads
    files_upload_post = {
      resource_key            = "files"
      http_method             = "POST"
      integration_type        = "AWS_PROXY"
      integration_http_method = "POST"
      lambda_arn              = aws_lambda_function.chat_agent.arn
      request_parameters      = {}
    }
    # POST method for filesystem operations
    filesystem_post = {
      resource_key            = "filesystem"
      http_method             = "POST"
      integration_type        = "AWS_PROXY"
      integration_http_method = "POST"
      lambda_arn              = module.filesystem_lambda.function_arn
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
    # POST method for SEC search (uses wrapper Lambda for SQS integration)
    sec_search_post = {
      resource_key            = "sec_search"
      http_method             = "POST"
      integration_type        = "AWS_PROXY"
      integration_http_method = "POST"
      lambda_arn              = module.sec_search_lambda.wrapper_function_arn != null ? module.sec_search_lambda.wrapper_function_arn : module.sec_search_lambda.function_arn
      request_parameters      = {}
      timeout_milliseconds    = 29000 # 29 seconds - max for API Gateway
    }
    # GET method for SEC search autocomplete
    sec_search_autocomplete_get = {
      resource_key            = "sec_search_autocomplete"
      http_method             = "GET"
      integration_type        = "AWS_PROXY"
      integration_http_method = "POST"
      lambda_arn              = module.sec_search_lambda.function_arn
      request_parameters      = {}
    }
    # GET method for SEC search job status
    sec_search_status_get = {
      resource_key            = "sec_search_status"
      http_method             = "GET"
      integration_type        = "AWS_PROXY"
      integration_http_method = "POST"
      lambda_arn              = module.sec_search_lambda.function_arn
      request_parameters      = {}
    }
    # POST method for SEC search job cancellation
    sec_search_cancel_post = {
      resource_key            = "sec_search_cancel"
      http_method             = "POST"
      integration_type        = "AWS_PROXY"
      integration_http_method = "POST"
      lambda_arn              = module.sec_search_lambda.function_arn
      request_parameters      = {}
    }
    # GET method for SEC search results (fetch from S3)
    sec_search_results_get = {
      resource_key            = "sec_search_results"
      http_method             = "GET"
      integration_type        = "AWS_PROXY"
      integration_http_method = "POST"
      lambda_arn              = module.sec_search_lambda.function_arn
      request_parameters      = {}
    }
    # POST method for politician trades search (uses wrapper Lambda for SQS integration)
    politician_trades_search_post = {
      resource_key            = "politician_trades_search"
      http_method             = "POST"
      integration_type        = "AWS_PROXY"
      integration_http_method = "POST"
      lambda_arn              = module.politician_trades_search_lambda.wrapper_function_arn != null ? module.politician_trades_search_lambda.wrapper_function_arn : module.politician_trades_search_lambda.function_arn
      request_parameters      = {}
      timeout_milliseconds    = 29000 # 29 seconds - max for API Gateway
    }
    # POST method for USAspending autocomplete (uses wrapper Lambda for SQS integration)
    usaspending_autocomplete_post = {
      resource_key            = "usaspending_autocomplete"
      http_method             = "POST"
      integration_type        = "AWS_PROXY"
      integration_http_method = "POST"
      lambda_arn              = module.usaspending_autocomplete_lambda.wrapper_function_arn != null ? module.usaspending_autocomplete_lambda.wrapper_function_arn : module.usaspending_autocomplete_lambda.function_arn
      request_parameters      = {}
      timeout_milliseconds    = 29000 # 29 seconds - max for API Gateway
    }
    # POST method for USAspending search (uses wrapper Lambda for SQS integration)
    usaspending_search_post = {
      resource_key            = "usaspending_search"
      http_method             = "POST"
      integration_type        = "AWS_PROXY"
      integration_http_method = "POST"
      lambda_arn              = module.usaspending_search_lambda.wrapper_function_arn != null ? module.usaspending_search_lambda.wrapper_function_arn : module.usaspending_search_lambda.function_arn
      request_parameters      = {}
      timeout_milliseconds    = 29000 # 29 seconds - max for API Gateway
    }
    # POST method for USAspending enrichment (uses wrapper Lambda for SQS integration)
    usaspending_enrichment_post = {
      resource_key            = "usaspending_enrichment"
      http_method             = "POST"
      integration_type        = "AWS_PROXY"
      integration_http_method = "POST"
      lambda_arn              = module.usaspending_enrichment_lambda.wrapper_function_arn != null ? module.usaspending_enrichment_lambda.wrapper_function_arn : module.usaspending_enrichment_lambda.function_arn
      request_parameters      = {}
      timeout_milliseconds    = 29000 # 29 seconds - max for API Gateway
    }
    # POST method for Congress Bills search
    congress_bills_search_post = {
      resource_key            = "congress_bills_search"
      http_method             = "POST"
      integration_type        = "AWS_PROXY"
      integration_http_method = "POST"
      lambda_arn              = module.congress_bills_search_lambda.wrapper_function_arn != null ? module.congress_bills_search_lambda.wrapper_function_arn : module.congress_bills_search_lambda.function_arn
      request_parameters      = {}
      timeout_milliseconds    = 29000 # 29 seconds - max for API Gateway
    }
    # POST method for LDA search (uses wrapper Lambda for SQS integration)
    lda_search_post = {
      resource_key            = "lda_search"
      http_method             = "POST"
      integration_type        = "AWS_PROXY"
      integration_http_method = "POST"
      lambda_arn              = module.lda_search_lambda.wrapper_function_arn != null ? module.lda_search_lambda.wrapper_function_arn : module.lda_search_lambda.function_arn
      request_parameters      = {}
      timeout_milliseconds    = 29000 # 29 seconds - max for API Gateway
    }
    # POST method for LDA autocomplete (uses wrapper Lambda for SQS integration)
    lda_autocomplete_post = {
      resource_key            = "lda_autocomplete"
      http_method             = "POST"
      integration_type        = "AWS_PROXY"
      integration_http_method = "POST"
      lambda_arn              = module.lda_autocomplete_lambda.wrapper_function_arn != null ? module.lda_autocomplete_lambda.wrapper_function_arn : module.lda_autocomplete_lambda.function_arn
      request_parameters      = {}
      timeout_milliseconds    = 29000 # 29 seconds - max for API Gateway
    }
    # OPTIONS methods are now automatically created by the API Gateway module
  }

  # Lambda permissions configuration
  lambda_permissions = {
    stock_volatility = {
      function_arn  = module.stock_volatility_lambda.wrapper_function_arn != null ? module.stock_volatility_lambda.wrapper_function_arn : module.stock_volatility_lambda.function_arn
      http_method   = "GET"
      resource_path = "volatility"
    }
    crypto_stats = {
      function_arn  = module.crypto_stats_lambda.wrapper_function_arn != null ? module.crypto_stats_lambda.wrapper_function_arn : module.crypto_stats_lambda.function_arn
      http_method   = "GET"
      resource_path = "crypto"
    }
    stock_data = {
      function_arn  = module.stock_data_lambda.wrapper_function_arn != null ? module.stock_data_lambda.wrapper_function_arn : module.stock_data_lambda.function_arn
      http_method   = "GET"
      resource_path = "stock-data"
    }
    stock_screener = {
      function_arn  = module.stock_screener_lambda.wrapper_function_arn != null ? module.stock_screener_lambda.wrapper_function_arn : module.stock_screener_lambda.function_arn
      http_method   = "POST"
      resource_path = "stock-screener"
    }
    portfolio = {
      function_arn  = module.portfolio_analysis_lambda.wrapper_function_arn != null ? module.portfolio_analysis_lambda.wrapper_function_arn : module.portfolio_analysis_lambda.function_arn
      http_method   = "POST"
      resource_path = "portfolio"
    }
    dashboard_get = {
      function_arn  = module.user_dashboard_lambda.wrapper_function_arn != null ? module.user_dashboard_lambda.wrapper_function_arn : module.user_dashboard_lambda.function_arn
      http_method   = "GET"
      resource_path = "dashboard"
    }
    dashboard_post = {
      function_arn  = module.user_dashboard_lambda.wrapper_function_arn != null ? module.user_dashboard_lambda.wrapper_function_arn : module.user_dashboard_lambda.function_arn
      http_method   = "POST"
      resource_path = "dashboard"
    }
    dashboard_put = {
      function_arn  = module.user_dashboard_lambda.wrapper_function_arn != null ? module.user_dashboard_lambda.wrapper_function_arn : module.user_dashboard_lambda.function_arn
      http_method   = "PUT"
      resource_path = "dashboard"
    }
    dashboard_delete = {
      function_arn  = module.user_dashboard_lambda.wrapper_function_arn != null ? module.user_dashboard_lambda.wrapper_function_arn : module.user_dashboard_lambda.function_arn
      http_method   = "DELETE"
      resource_path = "dashboard"
    }
    dashboard_reorder_put = {
      function_arn  = module.user_dashboard_lambda.wrapper_function_arn != null ? module.user_dashboard_lambda.wrapper_function_arn : module.user_dashboard_lambda.function_arn
      http_method   = "PUT"
      resource_path = "dashboard-reorder"
    }

    tiles_post = {
      function_arn  = module.user_dashboard_lambda.wrapper_function_arn != null ? module.user_dashboard_lambda.wrapper_function_arn : module.user_dashboard_lambda.function_arn
      http_method   = "POST"
      resource_path = "dashboard-tiles"
    }
    tiles_delete = {
      function_arn  = module.user_dashboard_lambda.wrapper_function_arn != null ? module.user_dashboard_lambda.wrapper_function_arn : module.user_dashboard_lambda.function_arn
      http_method   = "DELETE"
      resource_path = "dashboard-tiles"
    }
    tiles_put = {
      function_arn  = module.user_dashboard_lambda.wrapper_function_arn != null ? module.user_dashboard_lambda.wrapper_function_arn : module.user_dashboard_lambda.function_arn
      http_method   = "PUT"
      resource_path = "dashboard-tiles"
    }
    dashboard_share_post = {
      function_arn  = module.user_dashboard_lambda.wrapper_function_arn != null ? module.user_dashboard_lambda.wrapper_function_arn : module.user_dashboard_lambda.function_arn
      http_method   = "POST"
      resource_path = "dashboard-share"
    }
    alerts_get = {
      function_arn  = module.stock_alerts_lambda.wrapper_function_arn != null ? module.stock_alerts_lambda.wrapper_function_arn : module.stock_alerts_lambda.function_arn
      http_method   = "GET"
      resource_path = "alerts"
    }
    alerts_post = {
      function_arn  = module.stock_alerts_lambda.wrapper_function_arn != null ? module.stock_alerts_lambda.wrapper_function_arn : module.stock_alerts_lambda.function_arn
      http_method   = "POST"
      resource_path = "alerts"
    }
    alerts_delete = {
      function_arn  = module.stock_alerts_lambda.wrapper_function_arn != null ? module.stock_alerts_lambda.wrapper_function_arn : module.stock_alerts_lambda.function_arn
      http_method   = "DELETE"
      resource_path = "alerts"
    }
    sessions_get = {
      function_arn  = module.session_management_lambda.wrapper_function_arn != null ? module.session_management_lambda.wrapper_function_arn : module.session_management_lambda.function_arn
      http_method   = "GET"
      resource_path = "sessions"
    }
    sessions_post = {
      function_arn  = module.session_management_lambda.wrapper_function_arn != null ? module.session_management_lambda.wrapper_function_arn : module.session_management_lambda.function_arn
      http_method   = "POST"
      resource_path = "sessions"
    }
    sessions_get_specific = {
      function_arn  = module.session_management_lambda.wrapper_function_arn != null ? module.session_management_lambda.wrapper_function_arn : module.session_management_lambda.function_arn
      http_method   = "GET"
      resource_path = "session"
    }
    sessions_put = {
      function_arn  = module.session_management_lambda.wrapper_function_arn != null ? module.session_management_lambda.wrapper_function_arn : module.session_management_lambda.function_arn
      http_method   = "PUT"
      resource_path = "session"
    }
    sessions_delete = {
      function_arn  = module.session_management_lambda.wrapper_function_arn != null ? module.session_management_lambda.wrapper_function_arn : module.session_management_lambda.function_arn
      http_method   = "DELETE"
      resource_path = "session"
    }
    news_post = {
      function_arn  = module.news_search_lambda.wrapper_function_arn != null ? module.news_search_lambda.wrapper_function_arn : module.news_search_lambda.function_arn
      http_method   = "POST"
      resource_path = "news"
    }
    files_upload_post = {
      function_arn  = aws_lambda_function.chat_agent.arn
      http_method   = "POST"
      resource_path = "files"
    }
    filesystem_post = {
      function_arn  = module.filesystem_lambda.function_arn
      http_method   = "POST"
      resource_path = "filesystem"
    }
    file_download_post = {
      function_arn  = module.file_return_lambda.function_arn
      http_method   = "POST"
      resource_path = "file-download"
    }
    sec_search_post = {
      function_arn  = module.sec_search_lambda.wrapper_function_arn != null ? module.sec_search_lambda.wrapper_function_arn : module.sec_search_lambda.function_arn
      http_method   = "POST"
      resource_path = "sec-search"
    }
    sec_search_autocomplete_get = {
      function_arn  = module.sec_search_lambda.function_arn
      http_method   = "GET"
      resource_path = "sec-search-autocomplete"
    }
    sec_search_status_get = {
      function_arn  = module.sec_search_lambda.function_arn
      http_method   = "GET"
      resource_path = "sec-search-status"
    }
    sec_search_cancel_post = {
      function_arn  = module.sec_search_lambda.function_arn
      http_method   = "POST"
      resource_path = "sec-search-cancel"
    }
    sec_search_results_get = {
      function_arn  = module.sec_search_lambda.function_arn
      http_method   = "GET"
      resource_path = "sec-search-results"
    }
    politician_trades_search_post = {
      function_arn  = module.politician_trades_search_lambda.wrapper_function_arn != null ? module.politician_trades_search_lambda.wrapper_function_arn : module.politician_trades_search_lambda.function_arn
      http_method   = "POST"
      resource_path = "politician-trades-search"
    }
    usaspending_autocomplete_post = {
      function_arn  = module.usaspending_autocomplete_lambda.wrapper_function_arn != null ? module.usaspending_autocomplete_lambda.wrapper_function_arn : module.usaspending_autocomplete_lambda.function_arn
      http_method   = "POST"
      resource_path = "usaspending-autocomplete"
    }
    usaspending_search_post = {
      function_arn  = module.usaspending_search_lambda.wrapper_function_arn != null ? module.usaspending_search_lambda.wrapper_function_arn : module.usaspending_search_lambda.function_arn
      http_method   = "POST"
      resource_path = "usaspending-search"
    }
    usaspending_enrichment_post = {
      function_arn  = module.usaspending_enrichment_lambda.wrapper_function_arn != null ? module.usaspending_enrichment_lambda.wrapper_function_arn : module.usaspending_enrichment_lambda.function_arn
      http_method   = "POST"
      resource_path = "usaspending-enrichment"
    }
    congress_bills_search_post = {
      function_arn  = module.congress_bills_search_lambda.wrapper_function_arn != null ? module.congress_bills_search_lambda.wrapper_function_arn : module.congress_bills_search_lambda.function_arn
      http_method   = "POST"
      resource_path = "congress-bills-search"
    }
    lda_search_post = {
      function_arn  = module.lda_search_lambda.wrapper_function_arn != null ? module.lda_search_lambda.wrapper_function_arn : module.lda_search_lambda.function_arn
      http_method   = "POST"
      resource_path = "lda-search"
    }
    lda_autocomplete_post = {
      function_arn  = module.lda_autocomplete_lambda.wrapper_function_arn != null ? module.lda_autocomplete_lambda.wrapper_function_arn : module.lda_autocomplete_lambda.function_arn
      http_method   = "POST"
      resource_path = "lda-autocomplete"
    }
  }


  tags = var.common_tags

  # Deployment trigger - increment this when you want to force a redeployment
  deployment_trigger = "71" # Updated for filesystem endpoint
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
          "arn:aws:secretsmanager:*:*:secret:${var.project_name}-alpha-vantage-api-${var.environment}*",
          "arn:aws:secretsmanager:*:*:secret:${var.project_name}-encryption-secret-${var.environment}*"
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

# Encryption Secret for context item encryption/decryption
resource "aws_secretsmanager_secret" "encryption_secret" {
  name        = "${var.project_name}-encryption-secret-${var.environment}"
  description = "Secret key for encrypting/decrypting context items in the filesystem"

  recovery_window_in_days = 7

  tags = var.common_tags
}

# Encryption Secret Version (randomly generated)
resource "aws_secretsmanager_secret_version" "encryption_secret" {
  secret_id     = aws_secretsmanager_secret.encryption_secret.id
  secret_string = var.encryption_secret != "" ? var.encryption_secret : random_password.encryption_secret.result
}

# Random password for encryption secret (if not provided)
resource "random_password" "encryption_secret" {
  length  = 64
  special = true
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

# IAM Policy for SEC Search Lambda to access S3 filings bucket
resource "aws_iam_policy" "sec_search_s3_policy" {
  name        = "${var.project_name}-sec-search-s3-policy-${var.environment}"
  description = "Policy for SEC Search Lambda to access S3 filings bucket"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:GetObject",
          "s3:ListBucket"
        ]
        Resource = [
          "arn:aws:s3:::cosine-sec-filings-${var.environment}",
          "arn:aws:s3:::cosine-sec-filings-${var.environment}/*"
        ]
      }
    ]
  })

  tags = var.common_tags
}

resource "aws_iam_policy" "politician_trades_s3_policy" {
  name        = "${var.project_name}-politician-trades-s3-policy-${var.environment}"
  description = "Policy for file return Lambda to access S3 politician trades bucket"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:ListBucket"
        ]
        Resource = [
          "arn:aws:s3:::cosine-politician-trades-${var.environment}",
          "arn:aws:s3:::cosine-politician-trades-${var.environment}/*"
        ]
      }
    ]
  })

  tags = var.common_tags
}

resource "aws_iam_policy" "lda_disclosures_s3_policy" {
  name        = "${var.project_name}-lda-disclosures-s3-policy-${var.environment}"
  description = "Policy for file return Lambda to access S3 LDA disclosures bucket"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:ListBucket"
        ]
        Resource = [
          data.terraform_remote_state.base_infra.outputs.lda_disclosures_s3_bucket_arn,
          "${data.terraform_remote_state.base_infra.outputs.lda_disclosures_s3_bucket_arn}/*"
        ]
      }
    ]
  })

  tags = var.common_tags
}

resource "aws_iam_policy" "congress_bills_s3_policy" {
  name        = "${var.project_name}-congress-bills-s3-policy-${var.environment}"
  description = "Policy for file return Lambda to access S3 Congress bills bucket"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:ListBucket"
        ]
        Resource = [
          data.terraform_remote_state.base_infra.outputs.congress_bills_data_s3_bucket_arn,
          "${data.terraform_remote_state.base_infra.outputs.congress_bills_data_s3_bucket_arn}/*"
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
          "dynamodb:BatchGetItem",
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
          "${data.terraform_remote_state.base_infra.outputs.news_table_arn}/index/*",
          # Search tables for chat agent tools
          data.terraform_remote_state.base_infra.outputs.congress_bills_table_arn,
          "${data.terraform_remote_state.base_infra.outputs.congress_bills_table_arn}/index/*",
          data.terraform_remote_state.base_infra.outputs.usaspending_awards_table_arn,
          "${data.terraform_remote_state.base_infra.outputs.usaspending_awards_table_arn}/index/*",
          "arn:aws:dynamodb:${var.aws_region}:${data.aws_caller_identity.current.account_id}:table/cosine-politician-trades-${var.environment}",
          "arn:aws:dynamodb:${var.aws_region}:${data.aws_caller_identity.current.account_id}:table/cosine-politician-trades-${var.environment}/index/*"
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

# IAM Policy for Politician Trades Search Lambda to access DynamoDB
resource "aws_iam_policy" "politician_trades_search_dynamodb_policy" {
  name        = "${var.project_name}-politician-trades-search-dynamodb-policy-${var.environment}"
  description = "Policy for Politician Trades Search Lambda to access DynamoDB table"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:Query",
          "dynamodb:Scan",
          "dynamodb:GetItem",
          "dynamodb:BatchGetItem"
        ]
        Resource = [
          "arn:aws:dynamodb:${var.aws_region}:${data.aws_caller_identity.current.account_id}:table/cosine-politician-trades-${var.environment}",
          "arn:aws:dynamodb:${var.aws_region}:${data.aws_caller_identity.current.account_id}:table/cosine-politician-trades-${var.environment}/index/*"
        ]
      }
    ]
  })

  tags = var.common_tags
}


# IAM Policy for Lambda functions to publish to SNS (restricted to specific topic)
resource "aws_iam_policy" "lambda_sns_publish_policy_restricted" {
  name        = "${var.project_name}-lambda-sns-publish-policy-restricted-${var.environment}"
  description = "Policy for Lambda functions to publish to SEC search progress SNS topic (restricted)"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "sns:Publish"
        ]
        Resource = module.sec_search_progress_sns.topic_arn
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
      },
      {
        Effect = "Allow"
        Action = [
          "apigatewayv2:GetApis"
        ]
        Resource = "*"
        # Read-only permission to discover WebSocket API ID at runtime
        # Used when environment variables aren't set to avoid circular dependencies
      }
    ]
  })

  tags = var.common_tags
}

# IAM Policy for Lambda functions to receive messages from SQS - REMOVED
# SQS queues are no longer used - direct WebSocket delivery is used instead
# This policy has been removed to avoid empty policy document errors

# SES Module for email sending capabilities
module "ses" {
  source = "./modules/ses"

  project_name = var.project_name
  environment  = var.environment
  from_email   = var.ses_from_email
  common_tags  = var.common_tags
}

# Stock Volatility Lambda Function (with SQS and wrapper support)
module "stock_volatility_lambda" {
  source = "./modules/lambda-sqs"

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

  # Enable wrapper Lambda for synchronous API Gateway responses
  enable_wrapper_lambda       = true
  wrapper_timeout             = 60
  sns_topic_name              = "${var.project_name}-stock-volatility-completion-${var.environment}"
  response_table_name         = null
  completion_sns_env_var_name = "STOCK_VOLATILITY_COMPLETION_SNS_TOPIC_ARN"
  wrapper_layers = [
    data.terraform_remote_state.base_infra.outputs.core_layer_arn,
    data.terraform_remote_state.base_infra.outputs.financial_layer_arn
  ]
  sqs_enable_dlq                 = true
  sqs_batch_size                 = 1
  reserved_concurrent_executions = 10

  tags = var.common_tags
}

# Crypto Stats Lambda Function (with SQS and wrapper support)
module "crypto_stats_lambda" {
  source = "./modules/lambda-sqs"

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

  # Enable wrapper Lambda for synchronous API Gateway responses
  enable_wrapper_lambda       = true
  wrapper_timeout             = 60
  sns_topic_name              = "${var.project_name}-crypto-stats-completion-${var.environment}"
  response_table_name         = null
  completion_sns_env_var_name = "CRYPTO_STATS_COMPLETION_SNS_TOPIC_ARN"
  wrapper_layers = [
    data.terraform_remote_state.base_infra.outputs.core_layer_arn,
    data.terraform_remote_state.base_infra.outputs.crypto_layer_arn
  ]
  sqs_enable_dlq                 = true
  sqs_batch_size                 = 1
  reserved_concurrent_executions = 10

  tags = var.common_tags
}

# User Dashboard Lambda Function
# User Dashboard Lambda Function (with SQS and wrapper support)
module "user_dashboard_lambda" {
  source = "./modules/lambda-sqs"

  function_name = "${var.project_name}-user-dashboard-${var.environment}"
  description   = "Lambda function for user dashboard management"
  handler       = "lambda_function.lambda_handler"
  runtime       = "python3.11"
  timeout       = 60 # 1 minute for dashboard operations
  memory_size   = 256

  # Source directory
  source_dir = "../backend_app/src/user_dashboard/app"

  # Environment variables
  environment_variables = {
    USER_PROFILES_TABLE_NAME = data.terraform_remote_state.base_infra.outputs.user_profiles_table_name
    CHAT_FILES_BUCKET_NAME   = data.terraform_remote_state.base_infra.outputs.chat_files_bucket_name
    ENCRYPTION_SECRET        = aws_secretsmanager_secret_version.encryption_secret.secret_string
  }

  # Attach core and utility layers (utility layer includes cryptography for encryption)
  layers = [
    data.terraform_remote_state.base_infra.outputs.core_layer_arn,
    data.terraform_remote_state.base_infra.outputs.utility_layer_arn
  ]

  # Additional IAM policies
  additional_policy_arns = [
    aws_iam_policy.lambda_secrets_policy.arn,
    aws_iam_policy.lambda_dynamodb_policy.arn,
    aws_iam_policy.lambda_kms_policy.arn,
    data.terraform_remote_state.base_infra.outputs.lambda_s3_chat_files_policy_arn
  ]

  # Enable wrapper Lambda for synchronous API Gateway responses
  enable_wrapper_lambda = true
  wrapper_timeout       = 60 # 1 minute to match worker timeout
  sns_topic_name        = "${var.project_name}-user-dashboard-completion-${var.environment}"
  # Use DynamoDB table for response correlation (optional, can use SNS message attributes instead)
  response_table_name = null # Not needed for synchronous responses
  # Environment variable name for completion SNS topic in worker Lambda
  completion_sns_env_var_name = "USER_DASHBOARD_COMPLETION_SNS_TOPIC_ARN"
  # Attach core and utility layers to wrapper Lambda (utility layer includes cryptography)
  wrapper_layers = [
    data.terraform_remote_state.base_infra.outputs.core_layer_arn,
    data.terraform_remote_state.base_infra.outputs.utility_layer_arn
  ]

  # SQS configuration
  sqs_enable_dlq                 = true
  sqs_batch_size                 = 1
  reserved_concurrent_executions = 20 # Higher concurrency for dashboard operations

  tags = var.common_tags
}

# Stock Alerts Lambda Function (with SQS and wrapper support)
module "stock_alerts_lambda" {
  source = "./modules/lambda-sqs"

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

  # Enable wrapper Lambda for synchronous API Gateway responses
  enable_wrapper_lambda          = true
  wrapper_timeout                = 30
  sns_topic_name                 = "${var.project_name}-stock-alerts-completion-${var.environment}"
  response_table_name            = null
  completion_sns_env_var_name    = "STOCK_ALERTS_COMPLETION_SNS_TOPIC_ARN"
  wrapper_layers                 = [data.terraform_remote_state.base_infra.outputs.core_layer_arn]
  sqs_enable_dlq                 = true
  sqs_batch_size                 = 1
  reserved_concurrent_executions = 20

  tags = var.common_tags
}

# Stock Alert Trigger Lambda Function (with SQS and wrapper support)
# Note: This is triggered by scheduled events, but wrapper enables async processing if needed
module "stock_alert_trigger_lambda" {
  source = "./modules/lambda-sqs"

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

  # Enable wrapper Lambda (though this is primarily scheduled, wrapper enables async if needed)
  enable_wrapper_lambda          = true
  wrapper_timeout                = 300
  sns_topic_name                 = "${var.project_name}-stock-alert-trigger-completion-${var.environment}"
  response_table_name            = null
  completion_sns_env_var_name    = "STOCK_ALERT_TRIGGER_COMPLETION_SNS_TOPIC_ARN"
  wrapper_layers                 = [data.terraform_remote_state.base_infra.outputs.core_layer_arn]
  sqs_enable_dlq                 = true
  sqs_batch_size                 = 1
  reserved_concurrent_executions = 5

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

# IAM Policy for Chat Agent S3 access with restricted filesys permissions
# Chat agent can only read from filesys folder, but has full access elsewhere
resource "aws_iam_policy" "chat_agent_s3_restricted_policy" {
  name        = "${var.project_name}-chat-agent-s3-restricted-${var.environment}"
  description = "Allows Chat Agent to read from filesys folder (read-only) and full access to other chat files"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      # Explicitly deny write operations to filesys folder (must come first - Deny takes precedence)
      {
        Effect = "Deny"
        Action = [
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:PutObjectAcl",
          "s3:DeleteObjectVersion"
        ]
        Resource = [
          "${data.terraform_remote_state.base_infra.outputs.chat_files_bucket_arn}/users/*/filesys/*"
        ]
      },
      # Allow read-only access to filesys folder
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject"
        ]
        Resource = [
          "${data.terraform_remote_state.base_infra.outputs.chat_files_bucket_arn}/users/*/filesys/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "s3:ListBucket"
        ]
        Resource = [
          data.terraform_remote_state.base_infra.outputs.chat_files_bucket_arn
        ]
        Condition = {
          StringLike = {
            "s3:prefix" = ["users/*/filesys/*"]
          }
        }
      },
      # Allow full access to rest of the bucket (for normal file operations)
      # Note: This applies to all paths except filesys (which is already restricted above)
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:ListBucket",
          "s3:GeneratePresignedUrl"
        ]
        Resource = [
          data.terraform_remote_state.base_infra.outputs.chat_files_bucket_arn,
          "${data.terraform_remote_state.base_infra.outputs.chat_files_bucket_arn}/*"
        ]
      }
    ]
  })

  tags = var.common_tags
}

# Attach restricted S3 policy for chat files access
resource "aws_iam_role_policy_attachment" "chat_agent_s3_policy" {
  role       = aws_iam_role.chat_agent_execution_role.name
  policy_arn = aws_iam_policy.chat_agent_s3_restricted_policy.arn
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

# Attach WebSocket policy for chat agent (for direct WebSocket message delivery)
resource "aws_iam_role_policy_attachment" "chat_agent_websocket_policy" {
  role       = aws_iam_role.chat_agent_execution_role.name
  policy_arn = aws_iam_policy.lambda_websocket_policy.arn
}

# IAM Policy for Chat Agent to read from Stock Historical S3 Bucket (READ ONLY)
resource "aws_iam_policy" "chat_agent_stock_historical_s3_read_policy" {
  name        = "${var.project_name}-chat-agent-stock-historical-s3-read-${var.environment}"
  description = "Allows Chat Agent Lambda to read from stock historical data S3 bucket (READ ONLY)"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:ListBucket"
        ]
        Resource = [
          data.terraform_remote_state.base_infra.outputs.stock_historical_bucket_arn,
          "${data.terraform_remote_state.base_infra.outputs.stock_historical_bucket_arn}/*"
        ]
      }
    ]
  })

  tags = var.common_tags
}

# IAM Policy for Chat Agent to read from Search Data S3 Buckets (READ ONLY)
resource "aws_iam_policy" "chat_agent_search_data_s3_read_policy" {
  name        = "${var.project_name}-chat-agent-search-data-s3-read-${var.environment}"
  description = "Allows Chat Agent Lambda to read from search data S3 buckets (congress bills, usaspending, LDA disclosures) for oversized items (READ ONLY)"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:ListBucket"
        ]
        Resource = [
          data.terraform_remote_state.base_infra.outputs.congress_bills_data_s3_bucket_arn,
          "${data.terraform_remote_state.base_infra.outputs.congress_bills_data_s3_bucket_arn}/*",
          data.terraform_remote_state.base_infra.outputs.usaspending_data_s3_bucket_arn,
          "${data.terraform_remote_state.base_infra.outputs.usaspending_data_s3_bucket_arn}/*",
          data.terraform_remote_state.base_infra.outputs.lda_disclosures_s3_bucket_arn,
          "${data.terraform_remote_state.base_infra.outputs.lda_disclosures_s3_bucket_arn}/*"
        ]
      }
    ]
  })

  tags = var.common_tags
}

# Attach Search Data S3 read policy for chat agent
resource "aws_iam_role_policy_attachment" "chat_agent_search_data_s3_read_policy" {
  role       = aws_iam_role.chat_agent_execution_role.name
  policy_arn = aws_iam_policy.chat_agent_search_data_s3_read_policy.arn
}

# Attach Stock Historical S3 read policy for chat agent
resource "aws_iam_role_policy_attachment" "chat_agent_stock_historical_s3_read_policy" {
  role       = aws_iam_role.chat_agent_execution_role.name
  policy_arn = aws_iam_policy.chat_agent_stock_historical_s3_read_policy.arn
}

# SQS policy for chat agent - REMOVED
# SQS queues are no longer used - direct WebSocket delivery is used instead
# The chat_agent now sends logs and responses directly via WebSocket API Gateway
# This policy and its attachment have been removed to avoid empty policy document errors



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
          "arn:aws:bedrock:*:*:foundation-model/us.anthropic.claude-sonnet-4-20250514-v1:0",
          "arn:aws:bedrock:*:*:foundation-model/us.anthropic.claude-haiku-4-5-20251001-v1:0",
          "arn:aws:bedrock:*:*:foundation-model/us.amazon.nova-lite-v1:0",
          "arn:aws:bedrock:*:*:foundation-model/openai.gpt-oss-120b-1:0",
          "arn:aws:bedrock:*:*:foundation-model/openai.gpt-oss-20b-1:0",
          # Foundation models (legacy model IDs) - Fallback support
          "arn:aws:bedrock:*:*:foundation-model/anthropic.claude-sonnet-4-20250514-v1:0",
          "arn:aws:bedrock:*:*:foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0",
          "arn:aws:bedrock:*:*:foundation-model/anthropic.claude-3-haiku-20240307-v1:0",
          "arn:aws:bedrock:*:*:foundation-model/amazon.nova-lite-v1:0",
          # Inference profiles for cross-region inference
          "arn:aws:bedrock:*:*:inference-profile/us.anthropic.claude-sonnet-4-20250514-v1:0",
          "arn:aws:bedrock:*:*:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0",
          "arn:aws:bedrock:*:*:inference-profile/us.amazon.nova-lite-v1:0",
          "arn:aws:bedrock:*:*:inference-profile/openai.gpt-oss-120b-1:0",
          "arn:aws:bedrock:*:*:inference-profile/openai.gpt-oss-20b-1:0",
          # Inference profiles (legacy model IDs) - Fallback support
          "arn:aws:bedrock:*:*:inference-profile/anthropic.claude-sonnet-4-20250514-v1:0",
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
  timeout       = 900  # 15 minutes for extended processing
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
      STOCK_HISTORICAL_BUCKET     = data.terraform_remote_state.base_infra.outputs.stock_historical_bucket_name
      PROJECT_NAME                = var.project_name
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
      CHAT_FILES_BUCKET_NAME             = data.terraform_remote_state.base_infra.outputs.chat_files_bucket_name
      CONGRESS_BILLS_DATA_S3_BUCKET_NAME = data.terraform_remote_state.base_infra.outputs.congress_bills_data_s3_bucket_name
      AGENT_FILES_BUCKET_NAME            = data.terraform_remote_state.base_infra.outputs.chat_files_bucket_name

      # Encryption secret for decrypting .cosine files from filesystem
      ENCRYPTION_SECRET = aws_secretsmanager_secret_version.encryption_secret.secret_string

      # File Return Lambda Function Name for direct invocation
      FILE_RETURN_LAMBDA_NAME = module.file_return_lambda.function_name

      # Agent Files Processor Lambda Function Name for direct invocation
      # AGENT_FILES_PROCESSOR_FUNCTION_NAME removed - functionality moved to chat_agent utils

      # WebSocket API Gateway endpoint for direct message delivery
      # Note: These are set via data source lookup at runtime to avoid circular dependency
      # The websocket_handler.py will construct the endpoint from WEBSOCKET_API_ID if needed
    }
  }

  tags = var.common_tags

  # Force update when layer changes
  depends_on = [data.terraform_remote_state.base_infra]
}

# Note: Provisioned concurrency removed for now due to complexity with $LATEST
# Can be added later using AWS CLI or console after Lambda is deployed

# WebSocket Connection Manager Lambda Function
# Using standard lambda module - WebSocket connections are fast and don't need SQS/wrapper complexity
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
    # WebSocket API endpoint and ID removed to avoid circular dependency with websocket_api module
    # The connection manager will discover the API ID at runtime if needed
    ENVIRONMENT = var.environment
    LOG_LEVEL   = var.environment == "development" ? "DEBUG" : "INFO"
  }

  # Attach core layer
  layers = [data.terraform_remote_state.base_infra.outputs.core_layer_arn]

  # Additional IAM policies
  additional_policy_arns = [
    aws_iam_policy.lambda_dynamodb_policy.arn,
    aws_iam_policy.lambda_kms_policy.arn,
    aws_iam_policy.lambda_websocket_policy.arn
  ]

  # Reserved concurrency to prevent overwhelming the connection manager
  reserved_concurrent_executions = 20

  tags = var.common_tags
}

# WebSocket Message Processor Lambda Function - REMOVED
# Functionality consolidated into chat_agent container

# WebSocket API Gateway
# Note: Created after chat_agent to break circular dependency
# chat_agent env vars don't reference websocket_api to avoid cycle
# The websocket_handler.py will construct the endpoint at runtime
module "websocket_api" {
  source = "./modules/websocket-api"

  api_name        = "${var.project_name}-websocket-api-${var.environment}"
  api_description = "WebSocket API for real-time chat functionality"
  stage_name      = var.environment

  connection_lambda_arn  = module.websocket_connection_lambda.function_arn
  connection_lambda_name = module.websocket_connection_lambda.function_name
  message_lambda_arn     = aws_lambda_function.chat_agent.arn
  message_lambda_name    = aws_lambda_function.chat_agent.function_name

  tags = var.common_tags

  depends_on = [aws_lambda_function.chat_agent]
}

# Note: WebSocket API endpoint and ID are not set in chat_agent environment variables
# to avoid circular dependency. The websocket_handler.py will construct the endpoint
# at runtime using the API ID pattern or discover it via API Gateway Management API.
# If needed, these can be set manually after deployment or via a separate update script.

# ============================================================================
# SQS QUEUES REMOVED - Direct WebSocket delivery used instead
# ============================================================================

# Agent logs and chat responses are now sent directly to WebSocket
# No SQS queues needed - reduced latency and complexity

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

# Portfolio Analysis Lambda Function (with SQS and wrapper support)
module "portfolio_analysis_lambda" {
  source = "./modules/lambda-sqs"

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

  # Enable wrapper Lambda for synchronous API Gateway responses
  enable_wrapper_lambda = true
  wrapper_timeout       = 60 # Match worker timeout
  sns_topic_name        = "${var.project_name}-portfolio-analysis-completion-${var.environment}"
  # Use DynamoDB table for response correlation (optional, can use SNS message attributes instead)
  response_table_name = null # Not needed for synchronous responses
  # Environment variable name for completion SNS topic in worker Lambda
  completion_sns_env_var_name = "PORTFOLIO_ANALYSIS_COMPLETION_SNS_TOPIC_ARN"
  # Attach core layer to wrapper Lambda (boto3 and standard library)
  wrapper_layers = [
    data.terraform_remote_state.base_infra.outputs.core_layer_arn
  ]

  # SQS configuration
  sqs_enable_dlq                 = true
  sqs_batch_size                 = 1
  sqs_max_receive_count          = 3
  sqs_visibility_timeout_seconds = 120   # 2x worker timeout
  sqs_message_retention_seconds  = 86400 # 24 hours

  tags = var.common_tags
}

# Stock Screener Lambda Function (with SQS and wrapper support)
module "stock_screener_lambda" {
  source = "./modules/lambda-sqs"

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

  # Enable wrapper Lambda for synchronous API Gateway responses
  enable_wrapper_lambda = true
  wrapper_timeout       = 300 # 5 minutes to match worker timeout
  sns_topic_name        = "${var.project_name}-stock-screener-completion-${var.environment}"
  # Use DynamoDB table for response correlation (optional, can use SNS message attributes instead)
  response_table_name = null # Not needed for synchronous responses
  # Environment variable name for completion SNS topic in worker Lambda
  completion_sns_env_var_name = "STOCK_SCREENER_COMPLETION_SNS_TOPIC_ARN"
  # Attach core layer to wrapper Lambda (boto3 and standard library)
  wrapper_layers = [
    data.terraform_remote_state.base_infra.outputs.core_layer_arn
  ]

  # SQS configuration
  sqs_enable_dlq                 = true
  sqs_batch_size                 = 1
  reserved_concurrent_executions = 10 # Limit concurrent stock screening operations

  tags = var.common_tags
}

# Stock Data Lambda Function (with SQS and wrapper support)
module "stock_data_lambda" {
  source = "./modules/lambda-sqs"

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

  # Enable wrapper Lambda for synchronous API Gateway responses
  enable_wrapper_lambda       = true
  wrapper_timeout             = 60
  sns_topic_name              = "${var.project_name}-stock-data-completion-${var.environment}"
  response_table_name         = null
  completion_sns_env_var_name = "STOCK_DATA_COMPLETION_SNS_TOPIC_ARN"
  wrapper_layers = [
    data.terraform_remote_state.base_infra.outputs.core_layer_arn,
    data.terraform_remote_state.base_infra.outputs.financial_layer_arn
  ]
  sqs_enable_dlq                 = true
  sqs_batch_size                 = 1
  reserved_concurrent_executions = 10

  tags = var.common_tags
}

# Stock Statistics Lambda Function (with SQS and wrapper support)
module "stock_statistics_lambda" {
  source = "./modules/lambda-sqs"

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

  # Enable wrapper Lambda for synchronous API Gateway responses
  enable_wrapper_lambda       = true
  wrapper_timeout             = 60
  sns_topic_name              = "${var.project_name}-stock-statistics-completion-${var.environment}"
  response_table_name         = null
  completion_sns_env_var_name = "STOCK_STATISTICS_COMPLETION_SNS_TOPIC_ARN"
  wrapper_layers = [
    data.terraform_remote_state.base_infra.outputs.core_layer_arn,
    data.terraform_remote_state.base_infra.outputs.financial_layer_arn
  ]
  sqs_enable_dlq                 = true
  sqs_batch_size                 = 1
  reserved_concurrent_executions = 10

  tags = var.common_tags
}

# Volatility Fetch Lambda Function (with SQS and wrapper support)
module "volatility_fetch_lambda" {
  source = "./modules/lambda-sqs"

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

  # Enable wrapper Lambda for synchronous API Gateway responses
  enable_wrapper_lambda       = true
  wrapper_timeout             = 30
  sns_topic_name              = "${var.project_name}-volatility-fetch-completion-${var.environment}"
  response_table_name         = null
  completion_sns_env_var_name = "VOLATILITY_FETCH_COMPLETION_SNS_TOPIC_ARN"
  wrapper_layers = [
    data.terraform_remote_state.base_infra.outputs.core_layer_arn,
    data.terraform_remote_state.base_infra.outputs.financial_layer_arn
  ]
  sqs_enable_dlq                 = true
  sqs_batch_size                 = 1
  reserved_concurrent_executions = 10

  tags = var.common_tags
}

# Robinhood Integration Lambda Function (with SQS and wrapper support)
module "robinhood_integration_lambda" {
  source = "./modules/lambda-sqs"

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
    ENVIRONMENT                              = var.environment
    LOG_LEVEL                                = var.environment == "development" ? "DEBUG" : "INFO"
    PORTFOLIO_ANALYSIS_FUNCTION_NAME         = module.portfolio_analysis_lambda.function_name
    PORTFOLIO_ANALYSIS_WRAPPER_FUNCTION_NAME = module.portfolio_analysis_lambda.wrapper_function_name != null ? module.portfolio_analysis_lambda.wrapper_function_name : module.portfolio_analysis_lambda.function_name
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

  # Enable wrapper Lambda for synchronous API Gateway responses
  enable_wrapper_lambda       = true
  wrapper_timeout             = 60
  sns_topic_name              = "${var.project_name}-robinhood-integration-completion-${var.environment}"
  response_table_name         = null
  completion_sns_env_var_name = "ROBINHOOD_INTEGRATION_COMPLETION_SNS_TOPIC_ARN"
  wrapper_layers = [
    data.terraform_remote_state.base_infra.outputs.core_layer_arn,
    data.terraform_remote_state.base_infra.outputs.financial_layer_arn
  ]
  sqs_enable_dlq                 = true
  sqs_batch_size                 = 1
  reserved_concurrent_executions = 10

  tags = var.common_tags
}

# Session Management Lambda Function (with SQS and wrapper support)
module "session_management_lambda" {
  source = "./modules/lambda-sqs"

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

  # Enable wrapper Lambda for synchronous API Gateway responses
  enable_wrapper_lambda          = true
  wrapper_timeout                = 30
  sns_topic_name                 = "${var.project_name}-session-management-completion-${var.environment}"
  response_table_name            = null
  completion_sns_env_var_name    = "SESSION_MANAGEMENT_COMPLETION_SNS_TOPIC_ARN"
  wrapper_layers                 = [data.terraform_remote_state.base_infra.outputs.core_layer_arn]
  sqs_enable_dlq                 = true
  sqs_batch_size                 = 1
  reserved_concurrent_executions = 20

  tags = var.common_tags
}

# Filesystem Lambda Function
module "filesystem_lambda" {
  source = "./modules/lambda"

  function_name = "${var.project_name}-filesystem-${var.environment}"
  description   = "Lambda function for user filesystem management (S3-only storage)"
  handler       = "lambda_function.lambda_handler"
  runtime       = "python3.11"
  timeout       = 60
  memory_size   = 512

  source_dir = "../backend_app/src/filesystem/app"

  environment_variables = {
    CHAT_FILES_BUCKET_NAME = data.terraform_remote_state.base_infra.outputs.chat_files_bucket_name
    S3_BASE_URL            = "https://${data.terraform_remote_state.base_infra.outputs.chat_files_bucket_name}.s3.amazonaws.com"
    ENVIRONMENT            = var.environment
    LOG_LEVEL              = var.environment == "development" ? "DEBUG" : "INFO"
    ENCRYPTION_SECRET      = aws_secretsmanager_secret_version.encryption_secret.secret_string
  }

  layers = [
    data.terraform_remote_state.base_infra.outputs.core_layer_arn,
    data.terraform_remote_state.base_infra.outputs.utility_layer_arn
  ]

  additional_policy_arns = [
    data.terraform_remote_state.base_infra.outputs.lambda_s3_chat_files_policy_arn,
    data.terraform_remote_state.base_infra.outputs.kms_access_policy_arn,
    aws_iam_policy.lambda_secrets_policy.arn
  ]

  reserved_concurrent_executions = 20

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
    S3_BUCKET                          = data.terraform_remote_state.base_infra.outputs.chat_files_bucket_name
    SEC_FILINGS_BUCKET                 = "cosine-sec-filings-${var.environment}"
    POLITICIAN_TRADES_BUCKET           = "cosine-politician-trades-${var.environment}"
    LDA_DISCLOSURES_BUCKET             = data.terraform_remote_state.base_infra.outputs.lda_disclosures_s3_bucket_name
    CONGRESS_BILLS_DATA_S3_BUCKET_NAME = data.terraform_remote_state.base_infra.outputs.congress_bills_data_s3_bucket_name
    SESSIONS_TABLE                     = data.terraform_remote_state.base_infra.outputs.chat_sessions_table_name
    # WebSocket endpoint removed to avoid circular dependency with websocket_api module
    # The file_return Lambda can discover the endpoint at runtime if needed
    ENVIRONMENT       = var.environment
    LOG_LEVEL         = var.environment == "development" ? "DEBUG" : "INFO"
    ENCRYPTION_SECRET = aws_secretsmanager_secret_version.encryption_secret.secret_string
  }

  layers = [
    data.terraform_remote_state.base_infra.outputs.core_layer_arn,
    data.terraform_remote_state.base_infra.outputs.utility_layer_arn
  ]

  additional_policy_arns = [
    aws_iam_policy.lambda_dynamodb_policy.arn,
    data.terraform_remote_state.base_infra.outputs.lambda_s3_chat_files_policy_arn,
    aws_iam_policy.lambda_websocket_policy.arn,
    data.terraform_remote_state.base_infra.outputs.kms_access_policy_arn,
    aws_iam_policy.sec_search_s3_policy.arn,        # Add SEC filings bucket access
    aws_iam_policy.politician_trades_s3_policy.arn, # Add politician trades bucket access
    aws_iam_policy.lda_disclosures_s3_policy.arn,   # Add LDA disclosures bucket access
    aws_iam_policy.congress_bills_s3_policy.arn,    # Add Congress bills bucket access
    aws_iam_policy.lambda_secrets_policy.arn        # Add secrets manager access for encryption secret
  ]

  reserved_concurrent_executions = 20

  tags = var.common_tags
}

# News Search Lambda Function (with SQS and wrapper support)
module "news_search_lambda" {
  source = "./modules/lambda-sqs"

  function_name = "${var.project_name}-news-search-${var.environment}"
  description   = "Lambda function for news search with complex query expressions"
  handler       = "lambda_function.lambda_handler"
  runtime       = "python3.11"
  timeout       = 300 # 5 minutes for complex queries
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

  # Enable wrapper Lambda for synchronous API Gateway responses
  enable_wrapper_lambda = true
  wrapper_timeout       = 300 # 5 minutes to match worker timeout
  sns_topic_name        = "${var.project_name}-news-search-completion-${var.environment}"
  # Use DynamoDB table for response correlation (optional, can use SNS message attributes instead)
  response_table_name = null # Not needed for synchronous responses
  # Environment variable name for completion SNS topic in worker Lambda
  completion_sns_env_var_name = "NEWS_SEARCH_COMPLETION_SNS_TOPIC_ARN"
  # Attach core layer to wrapper Lambda (boto3 and standard library)
  wrapper_layers = [
    data.terraform_remote_state.base_infra.outputs.core_layer_arn
  ]

  # SQS configuration
  sqs_enable_dlq                 = true
  sqs_batch_size                 = 1
  reserved_concurrent_executions = 10 # Limit concurrent news searches

  tags = var.common_tags
}

# File Upload Lambda Function - REMOVED
# Functionality consolidated into chat_agent container

# Agent Files Processor Lambda Function - DEPRECATED
# Functionality has been moved to Chat/utils/agent_files_helper.py
# The Lambda code remains in backend_app/src/agent_files_processor/app for reference
# but is no longer deployed via Terraform

# ============================================================================
# SNS Topic for SEC Search Progress Updates
# ============================================================================

module "sec_search_progress_sns" {
  source = "./modules/sns"

  topic_name   = "${var.project_name}-sec-search-progress-${var.environment}"
  display_name = "SEC Search Progress Updates"
  purpose      = "Publish progress updates for SEC search operations"
  kms_key_arn  = local.kms_key_arn

  # Allow Lambda functions to publish to this topic
  allow_lambda_publish = true

  tags = merge(var.common_tags, {
    Purpose = "SEC Search Progress"
  })
}

# SEC Search Lambda Function (with SQS and wrapper support)
module "sec_search_lambda" {
  source = "./modules/lambda-sqs"

  function_name = "${var.project_name}-sec-search-${var.environment}"
  description   = "Lambda function for SEC EDGAR search and autocomplete functionality"
  handler       = "lambda_function.lambda_handler"
  runtime       = "python3.11"
  timeout       = 300 # 5 minutes
  memory_size   = 512

  # Source directory
  source_dir = "../backend_app/src/sec_search/scraper"

  # Environment variables
  # Note: Completion SNS topic ARN will be added via a separate resource after module creation
  environment_variables = {
    ENVIRONMENT                       = var.environment
    LOG_LEVEL                         = var.environment == "development" ? "DEBUG" : "INFO"
    MAX_RESULTS                       = "10"
    SEC_FILINGS_CACHE_TABLE           = data.terraform_remote_state.base_infra.outputs.sec_filings_table_name
    SEC_SEARCH_QUERY_CACHE_TABLE      = data.terraform_remote_state.base_infra.outputs.sec_search_query_cache_table_name
    SEC_FILINGS_S3_BUCKET             = "cosine-sec-filings-${var.environment}"
    SEC_SEARCH_PROGRESS_SNS_TOPIC_ARN = module.sec_search_progress_sns.topic_arn
  }

  # Attach core layer
  layers = [
    data.terraform_remote_state.base_infra.outputs.core_layer_arn
  ]

  # Additional IAM policies - DynamoDB access for caching, S3 access for filing storage, KMS for S3 encryption, SNS for progress updates, Lambda self-invocation for async jobs, and query cache table access
  # Note: SNS publish for completion will be added by the module
  additional_policy_arns = [
    aws_iam_policy.lambda_secrets_policy.arn,
    data.terraform_remote_state.base_infra.outputs.sec_filings_table_policy_arn,
    data.terraform_remote_state.base_infra.outputs.sec_search_query_cache_table_policy_arn,
    aws_iam_policy.sec_search_s3_policy.arn,
    aws_iam_policy.lambda_kms_policy.arn,
    aws_iam_policy.lambda_sns_publish_policy_restricted.arn,
    aws_iam_policy.lambda_invoke_policy.arn
  ]

  # Enable wrapper Lambda for synchronous API Gateway responses
  enable_wrapper_lambda = true
  wrapper_timeout       = 300 # 5 minutes to match worker timeout
  sns_topic_name        = "${var.project_name}-sec-search-completion-${var.environment}"
  # Use DynamoDB query cache table for response correlation (optional, can use SNS message attributes instead)
  response_table_name = data.terraform_remote_state.base_infra.outputs.sec_search_query_cache_table_name
  # Environment variable name for completion SNS topic in worker Lambda
  completion_sns_env_var_name = "SEC_SEARCH_COMPLETION_SNS_TOPIC_ARN"
  # Attach core layer to wrapper Lambda (boto3 and standard library)
  wrapper_layers = [
    data.terraform_remote_state.base_infra.outputs.core_layer_arn
  ]

  # SQS configuration
  sqs_enable_dlq                 = true
  sqs_batch_size                 = 1
  reserved_concurrent_executions = 10 # Limit concurrent SEC search operations

  tags = var.common_tags
}

# Politician Trades Search Lambda Function
# Politician Trades Search Lambda Function (with SQS and wrapper support)
module "politician_trades_search_lambda" {
  source = "./modules/lambda-sqs"

  function_name = "${var.project_name}-politician-trades-search-${var.environment}"
  description   = "Lambda function for searching politician trades in DynamoDB"
  handler       = "lambda_function.lambda_handler"
  runtime       = "python3.11"
  timeout       = 300 # 5 minutes for long-running queries
  memory_size   = 512

  # Source directory
  source_dir = "../backend_app/src/politician_trades_search/app"

  # Environment variables
  environment_variables = {
    ENVIRONMENT         = var.environment
    LOG_LEVEL           = var.environment == "development" ? "DEBUG" : "INFO"
    MAX_RESULTS         = "100"
    DYNAMODB_TABLE_NAME = "cosine-politician-trades-${var.environment}"
  }

  # Attach core layer
  layers = [
    data.terraform_remote_state.base_infra.outputs.core_layer_arn
  ]

  # Additional IAM policies - DynamoDB access for politician trades table
  additional_policy_arns = [
    aws_iam_policy.lambda_secrets_policy.arn,
    aws_iam_policy.politician_trades_search_dynamodb_policy.arn,
    aws_iam_policy.lambda_kms_policy.arn
  ]

  # Enable wrapper Lambda for synchronous API Gateway responses
  enable_wrapper_lambda = true
  wrapper_timeout       = 300 # 5 minutes to match worker timeout
  sns_topic_name        = "${var.project_name}-politician-trades-completion-${var.environment}"
  # Use DynamoDB table for response correlation (optional, can use SNS message attributes instead)
  response_table_name = null # Not needed for synchronous responses
  # Environment variable name for completion SNS topic in worker Lambda
  completion_sns_env_var_name = "POLITICIAN_TRADES_COMPLETION_SNS_TOPIC_ARN"
  # Attach core layer to wrapper Lambda (boto3 and standard library)
  wrapper_layers = [
    data.terraform_remote_state.base_infra.outputs.core_layer_arn
  ]

  # SQS configuration
  sqs_enable_dlq                 = true
  sqs_batch_size                 = 1
  reserved_concurrent_executions = 10 # Limit concurrent politician trades searches

  tags = var.common_tags
}

# USAspending Autocomplete Lambda Function (with SQS and wrapper support)
module "usaspending_autocomplete_lambda" {
  source = "./modules/lambda-sqs"

  function_name = "${var.project_name}-usaspending-autocomplete-${var.environment}"
  description   = "Lambda function for USAspending API autocomplete endpoints"
  handler       = "lambda_function.lambda_handler"
  runtime       = "python3.11"
  timeout       = 30
  memory_size   = 512

  # Source directory
  source_dir = "../backend_app/src/govt_contracts/autocomplete"

  # Environment variables
  environment_variables = {
    ENVIRONMENT            = var.environment
    LOG_LEVEL              = var.environment == "development" ? "DEBUG" : "INFO"
    USASPENDING_BASE_URL   = "https://api.usaspending.gov"
    USASPENDING_USER_AGENT = "Cosine Financial Platform (contact@cosine.financial)"
    REQUEST_TIMEOUT        = "30"
  }

  # Attach core layer (includes requests library)
  layers = [
    data.terraform_remote_state.base_infra.outputs.core_layer_arn
  ]

  # Additional IAM policies
  additional_policy_arns = [
    aws_iam_policy.lambda_secrets_policy.arn
  ]

  # Enable wrapper Lambda for synchronous API Gateway responses
  enable_wrapper_lambda = true
  wrapper_timeout       = 30 # Match worker timeout
  sns_topic_name        = "${var.project_name}-usaspending-autocomplete-completion-${var.environment}"
  # Use DynamoDB table for response correlation (optional, can use SNS message attributes instead)
  response_table_name = null # Not needed for synchronous responses
  # Environment variable name for completion SNS topic in worker Lambda
  completion_sns_env_var_name = "USASPENDING_AUTOCOMPLETE_COMPLETION_SNS_TOPIC_ARN"
  # Attach core layer to wrapper Lambda (boto3 and standard library)
  wrapper_layers = [
    data.terraform_remote_state.base_infra.outputs.core_layer_arn
  ]
  # SQS configuration
  sqs_enable_dlq                 = true
  sqs_batch_size                 = 1
  reserved_concurrent_executions = 20 # Autocomplete is fast, allow more concurrency

  tags = var.common_tags
}

# IAM Policy for USAspending Search Lambda to access DynamoDB awards table (read-only)
resource "aws_iam_policy" "usaspending_search_dynamodb_policy" {
  name        = "${var.project_name}-usaspending-search-dynamodb-policy-${var.environment}"
  description = "Policy for USAspending Search Lambda to query DynamoDB awards table"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:BatchGetItem", # Required for KEYS_ONLY GSI two-phase fetch approach
          "dynamodb:Query",
          "dynamodb:Scan"
        ]
        Resource = [
          data.terraform_remote_state.base_infra.outputs.usaspending_awards_table_arn,
          "${data.terraform_remote_state.base_infra.outputs.usaspending_awards_table_arn}/index/*"
        ]
      }
    ]
  })

  tags = var.common_tags
}

# IAM Policy for USAspending Search Lambda to access S3 bucket (read-only)
resource "aws_iam_policy" "usaspending_search_s3_policy" {
  name        = "${var.project_name}-usaspending-search-s3-policy-${var.environment}"
  description = "Policy for USAspending Search Lambda to read from S3 bucket for award details"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:ListBucket"
        ]
        Resource = [
          data.terraform_remote_state.base_infra.outputs.usaspending_data_s3_bucket_arn,
          "${data.terraform_remote_state.base_infra.outputs.usaspending_data_s3_bucket_arn}/*"
        ]
      }
    ]
  })

  tags = var.common_tags
}

# USAspending Search Lambda Function
# USAspending Search Lambda Function (with SQS and wrapper support)
module "usaspending_search_lambda" {
  source = "./modules/lambda-sqs"

  function_name = "${var.project_name}-usaspending-search-${var.environment}"
  description   = "Lambda function for searching USAspending awards in DynamoDB"
  handler       = "lambda_function.lambda_handler"
  runtime       = "python3.11"
  timeout       = 300 # 5 minutes for complex queries
  memory_size   = 512

  # Source directory
  source_dir = "../backend_app/src/govt_contracts/search"

  # Environment variables
  environment_variables = {
    ENVIRONMENT       = var.environment
    LOG_LEVEL         = var.environment == "development" ? "DEBUG" : "INFO"
    AWARDS_TABLE_NAME = data.terraform_remote_state.base_infra.outputs.usaspending_awards_table_name
    S3_BUCKET_NAME    = data.terraform_remote_state.base_infra.outputs.usaspending_data_s3_bucket_name
  }

  # Attach core layer
  layers = [
    data.terraform_remote_state.base_infra.outputs.core_layer_arn
  ]

  # Additional IAM policies - Read-only access to DynamoDB awards table and S3 bucket
  additional_policy_arns = [
    aws_iam_policy.lambda_secrets_policy.arn,
    aws_iam_policy.usaspending_search_dynamodb_policy.arn,
    aws_iam_policy.usaspending_search_s3_policy.arn,
    aws_iam_policy.lambda_kms_policy.arn
  ]

  # Enable wrapper Lambda for synchronous API Gateway responses
  enable_wrapper_lambda = true
  wrapper_timeout       = 300 # 5 minutes to match worker timeout
  sns_topic_name        = "${var.project_name}-usaspending-search-completion-${var.environment}"
  # Use DynamoDB table for response correlation (optional, can use SNS message attributes instead)
  response_table_name = null # Not needed for synchronous responses
  # Environment variable name for completion SNS topic in worker Lambda
  completion_sns_env_var_name = "USASPENDING_SEARCH_COMPLETION_SNS_TOPIC_ARN"
  # Attach core layer to wrapper Lambda (boto3 and standard library)
  wrapper_layers = [
    data.terraform_remote_state.base_infra.outputs.core_layer_arn
  ]

  # SQS configuration
  sqs_enable_dlq                 = true
  sqs_batch_size                 = 1
  reserved_concurrent_executions = 10 # Limit concurrent searches

  tags = var.common_tags
}

# IAM Policy for Congress Bills Search Lambda to access DynamoDB bills table (read-only)
resource "aws_iam_policy" "congress_bills_search_dynamodb_policy" {
  name        = "${var.project_name}-congress-bills-search-dynamodb-policy-${var.environment}"
  description = "Policy for Congress Bills Search Lambda to query DynamoDB bills table"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:BatchGetItem", # Required for KEYS_ONLY GSI two-phase fetch approach
          "dynamodb:Query",
          "dynamodb:Scan"
        ]
        Resource = [
          data.terraform_remote_state.base_infra.outputs.congress_bills_table_arn,
          "${data.terraform_remote_state.base_infra.outputs.congress_bills_table_arn}/index/*"
        ]
      }
    ]
  })

  tags = var.common_tags
}

# IAM Policy for Congress Bills Search Lambda to access S3 bucket (read-only)
resource "aws_iam_policy" "congress_bills_search_s3_policy" {
  name        = "${var.project_name}-congress-bills-search-s3-policy-${var.environment}"
  description = "Policy for Congress Bills Search Lambda to read from S3 bucket for bill details"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:ListBucket"
        ]
        Resource = [
          data.terraform_remote_state.base_infra.outputs.congress_bills_data_s3_bucket_arn,
          "${data.terraform_remote_state.base_infra.outputs.congress_bills_data_s3_bucket_arn}/*"
        ]
      }
    ]
  })

  tags = var.common_tags
}

# Congress Bills Search Lambda Function (with SQS and wrapper support)
module "congress_bills_search_lambda" {
  source = "./modules/lambda-sqs"

  function_name = "${var.project_name}-congress-bills-search-${var.environment}"
  description   = "Lambda function for searching congress bills in DynamoDB"
  handler       = "lambda_function.lambda_handler"
  runtime       = "python3.11"
  timeout       = 300 # 5 minutes for complex queries
  memory_size   = 512

  # Source directory
  source_dir = "../backend_app/src/congress_bills/search"

  # Environment variables
  environment_variables = {
    ENVIRONMENT      = var.environment
    LOG_LEVEL        = var.environment == "development" ? "DEBUG" : "INFO"
    BILLS_TABLE_NAME = data.terraform_remote_state.base_infra.outputs.congress_bills_table_name
    S3_BUCKET_NAME   = data.terraform_remote_state.base_infra.outputs.congress_bills_data_s3_bucket_name
  }

  # Attach core layer
  layers = [
    data.terraform_remote_state.base_infra.outputs.core_layer_arn
  ]

  # Additional IAM policies - Read-only access to DynamoDB bills table and S3 bucket
  additional_policy_arns = [
    aws_iam_policy.lambda_secrets_policy.arn,
    aws_iam_policy.congress_bills_search_dynamodb_policy.arn,
    aws_iam_policy.congress_bills_search_s3_policy.arn,
    aws_iam_policy.lambda_kms_policy.arn
  ]

  # Enable wrapper Lambda for synchronous API Gateway responses
  enable_wrapper_lambda = true
  wrapper_timeout       = 300 # 5 minutes to match worker timeout
  sns_topic_name        = "${var.project_name}-congress-bills-search-completion-${var.environment}"
  # Use DynamoDB table for response correlation (optional, can use SNS message attributes instead)
  response_table_name = null # Not needed for synchronous responses
  # Environment variable name for completion SNS topic in worker Lambda
  completion_sns_env_var_name = "CONGRESS_BILLS_SEARCH_COMPLETION_SNS_TOPIC_ARN"
  # Attach core layer to wrapper Lambda (boto3 and standard library)
  wrapper_layers = [
    data.terraform_remote_state.base_infra.outputs.core_layer_arn
  ]

  # SQS configuration
  sqs_enable_dlq                 = true
  sqs_batch_size                 = 1
  reserved_concurrent_executions = 10 # Limit concurrent congress bills searches

  tags = var.common_tags
}

# LDA Search Lambda Function (with SQS and wrapper support)
module "lda_search_lambda" {
  source = "./modules/lambda-sqs"

  function_name = "${var.project_name}-lda-search-${var.environment}"
  description   = "Lambda function for searching LDA filings in DynamoDB"
  handler       = "lambda_function.lambda_handler"
  runtime       = "python3.11"
  timeout       = 300 # 5 minutes for complex queries
  memory_size   = 512

  # Source directory
  source_dir = "../backend_app/src/lda_search/search"

  # Environment variables
  environment_variables = {
    ENVIRONMENT        = var.environment
    LOG_LEVEL          = var.environment == "development" ? "DEBUG" : "INFO"
    FILINGS_TABLE_NAME = data.terraform_remote_state.base_infra.outputs.lda_filings_table_name
  }

  # Attach core layer
  layers = [
    data.terraform_remote_state.base_infra.outputs.core_layer_arn
  ]

  # Additional IAM policies - Read-only access to DynamoDB filings table
  additional_policy_arns = [
    aws_iam_policy.lambda_secrets_policy.arn,
    aws_iam_policy.lda_search_dynamodb_policy.arn,
    aws_iam_policy.lambda_kms_policy.arn
  ]

  # Enable wrapper Lambda for synchronous API Gateway responses
  enable_wrapper_lambda = true
  wrapper_timeout       = 300 # 5 minutes to match worker timeout
  sns_topic_name        = "${var.project_name}-lda-search-completion-${var.environment}"
  # Use DynamoDB table for response correlation (optional, can use SNS message attributes instead)
  response_table_name = null # Not needed for synchronous responses
  # Environment variable name for completion SNS topic in worker Lambda
  completion_sns_env_var_name = "LDA_SEARCH_COMPLETION_SNS_TOPIC_ARN"
  # Attach core layer to wrapper Lambda (boto3 and standard library)
  wrapper_layers = [
    data.terraform_remote_state.base_infra.outputs.core_layer_arn
  ]

  # SQS configuration
  sqs_enable_dlq                 = true
  sqs_batch_size                 = 1
  reserved_concurrent_executions = 10 # Limit concurrent LDA searches

  tags = var.common_tags
}

# LDA Autocomplete Lambda Function (with SQS and wrapper support)
module "lda_autocomplete_lambda" {
  source = "./modules/lambda-sqs"

  function_name = "${var.project_name}-lda-autocomplete-${var.environment}"
  description   = "Lambda function for LDA autocomplete from S3 CSV files"
  handler       = "lambda_function.lambda_handler"
  runtime       = "python3.11"
  timeout       = 30
  memory_size   = 512

  # Source directory
  source_dir = "../backend_app/src/lda_search/autocomplete"

  # Environment variables
  environment_variables = {
    ENVIRONMENT    = var.environment
    LOG_LEVEL      = var.environment == "development" ? "DEBUG" : "INFO"
    S3_BUCKET_NAME = data.terraform_remote_state.base_infra.outputs.lda_disclosures_s3_bucket_name
    S3_PREFIX      = "lists/"
  }

  # Attach core layer
  layers = [
    data.terraform_remote_state.base_infra.outputs.core_layer_arn
  ]

  # Additional IAM policies - Read-only access to S3 bucket for CSV files
  additional_policy_arns = [
    aws_iam_policy.lambda_secrets_policy.arn,
    aws_iam_policy.lda_autocomplete_s3_policy.arn,
    aws_iam_policy.lambda_kms_policy.arn
  ]

  # Enable wrapper Lambda for synchronous API Gateway responses
  enable_wrapper_lambda = true
  wrapper_timeout       = 30 # Match worker timeout
  sns_topic_name        = "${var.project_name}-lda-autocomplete-completion-${var.environment}"
  # Use DynamoDB table for response correlation (optional, can use SNS message attributes instead)
  response_table_name = null # Not needed for synchronous responses
  # Environment variable name for completion SNS topic in worker Lambda
  completion_sns_env_var_name = "LDA_AUTOCOMPLETE_COMPLETION_SNS_TOPIC_ARN"
  # Attach core layer to wrapper Lambda (boto3 and standard library)
  wrapper_layers = [
    data.terraform_remote_state.base_infra.outputs.core_layer_arn
  ]

  # SQS configuration
  sqs_enable_dlq                 = true
  sqs_batch_size                 = 1
  reserved_concurrent_executions = 20 # Autocomplete is fast, allow more concurrency

  tags = var.common_tags
}

# IAM Policy for LDA Search Lambda to access DynamoDB filings table (read-only)
resource "aws_iam_policy" "lda_search_dynamodb_policy" {
  name        = "${var.project_name}-lda-search-dynamodb-policy-${var.environment}"
  description = "Policy for LDA Search Lambda to read DynamoDB filings table"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:Query",
          "dynamodb:BatchGetItem",
          "dynamodb:Scan"
        ]
        Resource = [
          data.terraform_remote_state.base_infra.outputs.lda_filings_table_arn,
          "${data.terraform_remote_state.base_infra.outputs.lda_filings_table_arn}/index/*"
        ]
      }
    ]
  })

  tags = var.common_tags
}

# IAM Policy for LDA Autocomplete Lambda to access S3 bucket (read-only for CSV files)
resource "aws_iam_policy" "lda_autocomplete_s3_policy" {
  name        = "${var.project_name}-lda-autocomplete-s3-policy-${var.environment}"
  description = "Policy for LDA Autocomplete Lambda to read CSV files from S3"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:ListBucket"
        ]
        Resource = [
          "${data.terraform_remote_state.base_infra.outputs.lda_disclosures_s3_bucket_arn}/lists/*",
          data.terraform_remote_state.base_infra.outputs.lda_disclosures_s3_bucket_arn
        ]
      }
    ]
  })

  tags = var.common_tags
}

# IAM Policy for USAspending Enrichment Lambda to access DynamoDB awards table (read/write)
resource "aws_iam_policy" "usaspending_enrichment_dynamodb_policy" {
  name        = "${var.project_name}-usaspending-enrichment-dynamodb-policy-${var.environment}"
  description = "Policy for USAspending Enrichment Lambda to read/write DynamoDB awards table"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:Query",
          "dynamodb:Scan"
        ]
        Resource = [
          data.terraform_remote_state.base_infra.outputs.usaspending_awards_table_arn,
          "${data.terraform_remote_state.base_infra.outputs.usaspending_awards_table_arn}/index/*"
        ]
      }
    ]
  })

  tags = var.common_tags
}

# IAM Policy for USAspending Enrichment Lambda to access S3 bucket (read/write for oversized items)
resource "aws_iam_policy" "usaspending_enrichment_s3_policy" {
  name        = "${var.project_name}-usaspending-enrichment-s3-policy-${var.environment}"
  description = "Policy for USAspending Enrichment Lambda to read/write S3 bucket for award details"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:ListBucket"
        ]
        Resource = [
          data.terraform_remote_state.base_infra.outputs.usaspending_data_s3_bucket_arn,
          "${data.terraform_remote_state.base_infra.outputs.usaspending_data_s3_bucket_arn}/*"
        ]
      }
    ]
  })

  tags = var.common_tags
}

# USAspending Enrichment Lambda Function (with SQS and wrapper support)
module "usaspending_enrichment_lambda" {
  source = "./modules/lambda-sqs"

  function_name = "${var.project_name}-usaspending-enrichment-${var.environment}"
  description   = "Lambda function for enriching USAspending awards with up-to-date data from API"
  handler       = "lambda_function.lambda_handler"
  runtime       = "python3.11"
  timeout       = 300  # 5 minutes - enrichment may take time for large awards
  memory_size   = 1024 # More memory for processing large datasets

  # Source directory
  source_dir = "../backend_app/src/govt_contracts/enrichment"

  # Environment variables
  environment_variables = {
    ENVIRONMENT            = var.environment
    LOG_LEVEL              = var.environment == "development" ? "DEBUG" : "INFO"
    AWARDS_TABLE_NAME      = data.terraform_remote_state.base_infra.outputs.usaspending_awards_table_name
    S3_BUCKET_NAME         = data.terraform_remote_state.base_infra.outputs.usaspending_data_s3_bucket_name
    USASPENDING_BASE_URL   = "https://api.usaspending.gov"
    USASPENDING_USER_AGENT = "Cosine Financial Platform (contact@cosine.financial)"
    REQUEST_TIMEOUT        = "30"
    MAX_RETRIES            = "5"
    RETRY_BASE_DELAY       = "2.0"
  }

  # Attach core layer (includes requests library)
  layers = [
    data.terraform_remote_state.base_infra.outputs.core_layer_arn
  ]

  # Additional IAM policies - Read/write access to DynamoDB awards table and S3 bucket
  additional_policy_arns = [
    aws_iam_policy.lambda_secrets_policy.arn,
    aws_iam_policy.usaspending_enrichment_dynamodb_policy.arn,
    aws_iam_policy.usaspending_enrichment_s3_policy.arn,
    aws_iam_policy.lambda_kms_policy.arn
  ]

  # Enable wrapper Lambda for synchronous API Gateway responses
  enable_wrapper_lambda = true
  wrapper_timeout       = 300 # 5 minutes to match worker timeout
  sns_topic_name        = "${var.project_name}-usaspending-enrichment-completion-${var.environment}"
  # Use DynamoDB table for response correlation (optional, can use SNS message attributes instead)
  response_table_name = null # Not needed for synchronous responses
  # Environment variable name for completion SNS topic in worker Lambda
  completion_sns_env_var_name = "USASPENDING_ENRICHMENT_COMPLETION_SNS_TOPIC_ARN"
  # Attach core layer to wrapper Lambda (boto3 and standard library)
  wrapper_layers = [
    data.terraform_remote_state.base_infra.outputs.core_layer_arn
  ]
  # SQS configuration
  sqs_enable_dlq                 = true
  sqs_batch_size                 = 1
  reserved_concurrent_executions = 10 # Limit concurrent enrichments

  tags = var.common_tags
}

# SEC Search Progress Subscriber Lambda Function (with SQS and wrapper support)
# Note: This is primarily triggered by SNS, but wrapper enables async processing if needed
module "sec_search_progress_subscriber_lambda" {
  source = "./modules/lambda-sqs"

  function_name = "${var.project_name}-sec-search-progress-subscriber-${var.environment}"
  description   = "Lambda function that subscribes to SNS progress events and updates DynamoDB"
  handler       = "lambda_function.lambda_handler"
  runtime       = "python3.11"
  timeout       = 60
  memory_size   = 256

  # Source directory
  source_dir = "../backend_app/src/sec_search/progress_subscriber"

  # Environment variables
  environment_variables = {
    ENVIRONMENT                  = var.environment
    LOG_LEVEL                    = var.environment == "development" ? "DEBUG" : "INFO"
    SEC_SEARCH_QUERY_CACHE_TABLE = data.terraform_remote_state.base_infra.outputs.sec_search_query_cache_table_name
  }

  # Attach core layer
  layers = [
    data.terraform_remote_state.base_infra.outputs.core_layer_arn
  ]

  # Additional IAM policies - DynamoDB access for updating job status in query cache table
  additional_policy_arns = [
    aws_iam_policy.lambda_secrets_policy.arn,
    data.terraform_remote_state.base_infra.outputs.sec_search_query_cache_table_policy_arn,
    aws_iam_policy.lambda_kms_policy.arn
  ]

  # Enable wrapper Lambda (though this is primarily SNS-triggered, wrapper enables async if needed)
  enable_wrapper_lambda          = true
  wrapper_timeout                = 60
  sns_topic_name                 = "${var.project_name}-sec-search-progress-subscriber-completion-${var.environment}"
  response_table_name            = null
  completion_sns_env_var_name    = "SEC_SEARCH_PROGRESS_SUBSCRIBER_COMPLETION_SNS_TOPIC_ARN"
  wrapper_layers                 = [data.terraform_remote_state.base_infra.outputs.core_layer_arn]
  sqs_enable_dlq                 = true
  sqs_batch_size                 = 1
  reserved_concurrent_executions = 10

  tags = var.common_tags
}

# SNS Subscription: Subscribe progress subscriber Lambda to SNS topic
resource "aws_sns_topic_subscription" "sec_search_progress_subscription" {
  topic_arn = module.sec_search_progress_sns.topic_arn
  protocol  = "lambda"
  endpoint  = module.sec_search_progress_subscriber_lambda.function_arn
}

# Lambda Permission: Allow SNS to invoke the progress subscriber Lambda
resource "aws_lambda_permission" "sec_search_progress_subscriber_sns_invoke" {
  statement_id  = "AllowExecutionFromSNS"
  action        = "lambda:InvokeFunction"
  function_name = module.sec_search_progress_subscriber_lambda.function_name
  principal     = "sns.amazonaws.com"
  source_arn    = module.sec_search_progress_sns.topic_arn
}