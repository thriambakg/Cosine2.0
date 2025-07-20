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

# Lambda Layer for shared dependencies
module "shared_layer" {
  source = "./modules/lambda-layer"
  
  project_name = var.project_name
  environment  = var.environment
}

# Stock Volatility Lambda Function
module "stock_volatility_lambda" {
  source = "./modules/lambda"
  
  function_name                 = "stock-volatility"
  description                  = "Lambda function for stock volatility calculation using yfinance"
  runtime                      = "python3.11"
  handler                      = "lambda_function.lambda_handler"
  source_dir                   = "../backend_app/src/stocks/volatility_fetch/app"
  timeout                      = 60
  memory_size                  = 512
  environment_variables        = {
    ENVIRONMENT = var.environment
  }
  create_api_gateway_permission = true
  kms_key_arn                  = aws_kms_key.main.arn
  layers                       = [module.shared_layer.layer_arn]
  project_name                 = var.project_name
  environment                  = var.environment
  
  tags = var.common_tags
  
  depends_on = [module.shared_layer]
}

