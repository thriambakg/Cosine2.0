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

# CloudFront Distribution OAC Bucket Policy (separate resource to avoid circular dependency)
resource "aws_s3_bucket_policy" "cloudfront_oac" {
  count  = var.use_cloudfront_deployment ? 1 : 0
  bucket = data.aws_s3_bucket.static_hosting.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowCloudFrontServicePrincipal"
        Effect = "Allow"
        Principal = {
          Service = "cloudfront.amazonaws.com"
        }
        Action   = "s3:GetObject"
        Resource = "${data.aws_s3_bucket.static_hosting.arn}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = length(module.cloudfront) > 0 ? module.cloudfront[0].distribution_arn : ""
          }
        }
      }
    ]
  })

  depends_on = [module.cloudfront]
}

# Custom IAM policy for stock volatility Lambda (temporarily disabled until IAM permissions are granted)
resource "aws_iam_policy" "stock_volatility_lambda_policy" {
  count       = 0 # Temporarily disabled - requires iam:CreatePolicy permission
  name        = "${var.project_name}-stock-volatility-policy-${var.environment}"
  description = "Custom policy for stock volatility Lambda function"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject"
        ]
        Resource = [
          "arn:aws:s3:::${var.project_name}-*/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = [
          "arn:aws:secretsmanager:*:*:secret:${var.project_name}/*"
        ]
      }
    ]
  })

  tags = var.common_tags
}

# Stock Volatility Lambda Function (temporarily disabled until IAM permissions are granted)
module "stock_volatility_lambda" {
  count  = 0 # Temporarily disabled - requires iam:CreateRole permission  
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

  # Additional IAM policies (temporarily empty until permissions are granted)
  additional_policy_arns = [
    # aws_iam_policy.stock_volatility_lambda_policy.arn # Disabled until IAM permissions granted
  ]

  tags = var.common_tags
}

# VPC for secure networking
module "vpc" {
  source = "./modules/vpc"

  project_name = var.project_name
  environment  = var.environment
  vpc_cidr     = var.vpc_cidr
  az_count     = var.az_count
  kms_key_arn  = aws_kms_key.main.arn

  tags = var.common_tags
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
# CUSTOM DOMAIN CONFIGURATION - PHASE 2: DNS RECORDS
# For CloudFront, DNS records will be handled separately if needed
# ============================================================================

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
  custom_error_responses = [
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
    }
  ]

  tags = var.common_tags

  depends_on = [data.aws_s3_bucket.static_hosting]
}

