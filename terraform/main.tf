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

# Local values for resource naming
locals {
  bucket_name = "${var.project_name}-frontend-${var.environment}"
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
              "arn:aws:logs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:log-group:/ecs/${var.project_name}*",
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

# CloudWatch Log Groups for ECS
resource "aws_cloudwatch_log_group" "ecs" {
  name              = "/ecs/${var.project_name}-${var.environment}"
  retention_in_days = 30
  kms_key_id        = aws_kms_key.main.arn

  tags = merge(var.common_tags, {
    Name = "${var.project_name}-ecs-logs-${var.environment}"
  })
}

resource "aws_cloudwatch_log_group" "frontend" {
  name              = "/ecs/${var.project_name}-frontend-${var.environment}"
  retention_in_days = 30
  kms_key_id        = aws_kms_key.main.arn

  tags = merge(var.common_tags, {
    Name = "${var.project_name}-frontend-logs-${var.environment}"
  })
}

# S3 Buckets Module (temporarily disabled until S3 permissions are granted)
module "s3_buckets" {
  count  = 0 # Temporarily disabled - requires s3:CreateBucket permission
  source = "./modules/s3"

  bucket_name       = local.bucket_name
  kms_key_arn       = aws_kms_key.main.arn
  enable_versioning = true
  log_prefix        = "access-logs/"

  tags = var.common_tags
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

# ECR Repository for frontend container
module "ecr" {
  source = "./modules/ecr"

  project_name = var.project_name
  environment  = var.environment
  kms_key_arn  = aws_kms_key.main.arn

  tags = var.common_tags
}

# Application Load Balancer with WAF
module "alb" {
  source = "./modules/alb"

  project_name       = var.project_name
  environment        = var.environment
  vpc_id             = module.vpc.vpc_id
  public_subnet_ids  = module.vpc.public_subnet_ids
  certificate_arn    = var.enable_custom_domain ? module.domain[0].certificate_arn : var.certificate_arn
  enable_access_logs = var.enable_alb_access_logs
  access_logs_bucket = var.alb_access_logs_bucket
  kms_key_arn        = aws_kms_key.main.arn
  rate_limit         = var.waf_rate_limit
  blocked_countries  = var.waf_blocked_countries
  enable_waf_logging = var.enable_waf_logging

  tags = var.common_tags

  depends_on = [module.vpc]
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
# A records pointing to ALB (depends on ALB being created)
# ============================================================================

module "domain_records" {
  count  = var.enable_custom_domain ? 1 : 0
  source = "./modules/domain-records"

  enable_custom_domain = var.enable_custom_domain
  domain_name          = var.domain_name
  subdomain            = var.environment == "production" ? var.production_subdomain : var.staging_subdomain
  hosted_zone_id       = module.domain[0].hosted_zone_id
  alb_dns_name         = module.alb.alb_dns_name
  alb_zone_id          = module.alb.alb_zone_id

  depends_on = [module.alb, module.domain]
}

# ============================================================================
# FRONTEND APPLICATION DEPLOYMENT - ECS Service with Cognito & DynamoDB
# ============================================================================

# ECS Service for frontend with authentication and database integration
module "ecs" {
  source = "./modules/ecs"

  project_name          = var.project_name
  environment           = var.environment
  aws_region            = var.aws_region
  vpc_id                = module.vpc.vpc_id
  private_subnet_ids    = module.vpc.private_subnet_ids
  alb_security_group_id = module.alb.security_group_id
  target_group_arn      = module.alb.target_group_arn
  ecr_repository_url    = module.ecr.repository_url
  ecr_repository_arn    = module.ecr.repository_arn
  kms_key_arn           = aws_kms_key.main.arn

  # CloudWatch Log Groups
  ecs_log_group_name      = aws_cloudwatch_log_group.ecs.name
  frontend_log_group_name = aws_cloudwatch_log_group.frontend.name

  # Cognito configuration - get from base infrastructure
  cognito_user_pool_id = try(data.terraform_remote_state.base_infra.outputs.cognito_user_pool_id, var.cognito_user_pool_id)
  cognito_client_id    = try(data.terraform_remote_state.base_infra.outputs.cognito_user_pool_client_id, var.cognito_client_id)
  cognito_domain       = try(data.terraform_remote_state.base_infra.outputs.cognito_user_pool_domain, var.cognito_domain)
  api_gateway_url      = var.api_gateway_url

  # DynamoDB configuration - get from base infrastructure
  user_profiles_table_name   = try(data.terraform_remote_state.base_infra.outputs.user_profiles_table_name, var.user_profiles_table_name)
  security_events_table_name = try(data.terraform_remote_state.base_infra.outputs.security_events_table_name, var.security_events_table_name)
  user_sessions_table_name   = try(data.terraform_remote_state.base_infra.outputs.user_sessions_table_name, var.user_sessions_table_name)

  # ECS configuration
  task_cpu                 = var.ecs_task_cpu
  task_memory              = var.ecs_task_memory
  task_memory_reservation  = var.ecs_task_memory_reservation
  desired_count            = var.ecs_desired_count
  enable_service_discovery = var.enable_service_discovery
  enable_execute_command   = var.enable_ecs_execute_command

  tags = var.common_tags

  # Pass the ALB ready signal as a dependency to ensure it's fully created before the ECS service
  alb_dependency = module.alb.alb_ready

  depends_on = [module.alb, aws_cloudwatch_log_group.ecs, aws_cloudwatch_log_group.frontend]
}

