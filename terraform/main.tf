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

  tags = merge(var.common_tags, {
    Name = "${var.project_name}-kms-key-${var.environment}"
  })
}

resource "aws_kms_alias" "main" {
  name          = "alias/${var.project_name}-${var.environment}"
  target_key_id = aws_kms_key.main.key_id
}

# S3 Bucket for Frontend (conditional)
resource "aws_s3_bucket" "frontend" {
  count  = var.enable_s3_bucket ? 1 : 0
  bucket = local.bucket_name

  tags = merge(var.common_tags, {
    Name = local.bucket_name
    Type = "frontend"
  })
}

resource "aws_s3_bucket_ownership_controls" "frontend" {
  count  = var.enable_s3_bucket ? 1 : 0
  bucket = aws_s3_bucket.frontend[0].id
  
  rule {
    object_ownership = "BucketOwnerPreferred"
  }
}

resource "aws_s3_bucket_acl" "frontend" {
  count      = var.enable_s3_bucket ? 1 : 0
  depends_on = [aws_s3_bucket_ownership_controls.frontend]
  bucket     = aws_s3_bucket.frontend[0].id
  acl        = "private"
}

resource "aws_s3_bucket_public_access_block" "frontend" {
  count  = var.enable_s3_bucket ? 1 : 0
  bucket = aws_s3_bucket.frontend[0].id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "frontend" {
  count  = var.enable_s3_bucket ? 1 : 0
  bucket = aws_s3_bucket.frontend[0].id
  
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "frontend" {
  count  = var.enable_s3_bucket ? 1 : 0
  bucket = aws_s3_bucket.frontend[0].id

  rule {
    apply_server_side_encryption_by_default {
      kms_master_key_id = aws_kms_key.main.arn
      sse_algorithm     = "aws:kms"
    }
    bucket_key_enabled = true
  }
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

