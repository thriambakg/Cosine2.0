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
          ArnEquals = {
            "kms:EncryptionContext:aws:logs:arn" = "arn:aws:logs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/${var.project_name}-*"
          }
        }
      }
    ]
  })

  tags = merge(var.common_tags, {
    Name = "${var.project_name}-kms-key-${var.environment}"
  })
}

# Data sources for account and region info
data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

resource "aws_kms_alias" "main" {
  name          = "alias/${var.project_name}-${var.environment}"
  target_key_id = aws_kms_key.main.key_id
}

# S3 Buckets Module (conditional)
module "s3_buckets" {
  count  = var.enable_s3_bucket ? 1 : 0
  source = "./modules/s3"

  bucket_name       = local.bucket_name
  kms_key_arn       = aws_kms_key.main.arn
  enable_versioning = true
  log_prefix        = "access-logs/"

  tags = var.common_tags
}

# Stock Volatility Lambda Function
module "stock_volatility_lambda" {
  source = "./modules/lambda"

  function_name = "stock-volatility"
  description   = "Lambda function for stock volatility calculation using yfinance"
  runtime       = "python3.11"
  handler       = "lambda_function.lambda_handler"
  source_dir    = "../backend_app/src/stocks/volatility_fetch/app"
  timeout       = 60
  memory_size   = 512
  environment_variables = {
    ENVIRONMENT = var.environment
  }
  create_api_gateway_permission = true
  kms_key_arn                   = aws_kms_key.main.arn
  project_name                  = var.project_name
  environment                   = var.environment

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

  project_name          = var.project_name
  environment           = var.environment
  vpc_id               = module.vpc.vpc_id
  public_subnet_ids    = module.vpc.public_subnet_ids
  certificate_arn      = var.certificate_arn
  enable_access_logs   = var.enable_alb_access_logs
  access_logs_bucket   = var.alb_access_logs_bucket
  kms_key_arn         = aws_kms_key.main.arn
  rate_limit          = var.waf_rate_limit
  blocked_countries   = var.waf_blocked_countries

  tags = var.common_tags
}

# ECS Service for frontend
module "ecs" {
  source = "./modules/ecs"

  project_name           = var.project_name
  environment            = var.environment
  aws_region            = var.aws_region
  vpc_id                = module.vpc.vpc_id
  private_subnet_ids    = module.vpc.private_subnet_ids
  alb_security_group_id = module.alb.security_group_id
  target_group_arn      = module.alb.target_group_arn
  ecr_repository_url    = module.ecr.repository_url
  kms_key_arn          = aws_kms_key.main.arn
  
  # Cognito configuration - get from existing infrastructure
  cognito_user_pool_id = var.cognito_user_pool_id
  cognito_client_id    = var.cognito_client_id
  cognito_domain       = var.cognito_domain
  api_gateway_url      = var.api_gateway_url

  # ECS configuration
  task_cpu                 = var.ecs_task_cpu
  task_memory             = var.ecs_task_memory
  task_memory_reservation = var.ecs_task_memory_reservation
  desired_count           = var.ecs_desired_count
  enable_service_discovery = var.enable_service_discovery
  enable_execute_command  = var.enable_ecs_execute_command

  tags = var.common_tags

  depends_on = [module.alb]
}

