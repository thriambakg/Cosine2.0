# Staging Environment Configuration

terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.0"
    }
  }

  backend "s3" {
    bucket         = "cosine-terraform-state-bucket"  # Update with your bucket name
    key            = "cosine2.0/staging/terraform.tfstate"
    region         = "us-east-1"  # Update with your region
    dynamodb_table = "cosine-terraform-locks"  # Update with your table name
    encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Environment = "staging"
      Project     = "cosine2.0"
      ManagedBy   = "terraform"
    }
  }
}

# Local variables
locals {
  environment = "staging"
  project_name = "cosine"
  
  common_tags = {
    Environment = local.environment
    Project     = "cosine2.0"
    ManagedBy   = "terraform"
    Owner       = "team"
  }
}

# Module instantiation
module "cosine_app" {
  source = "../../modules/cosine-app"

  environment               = local.environment
  project_name             = local.project_name
  lambda_runtime           = var.lambda_runtime
  lambda_timeout           = var.lambda_timeout
  robinhood_lambda_timeout = var.robinhood_lambda_timeout
  log_level               = var.log_level
  common_tags             = local.common_tags
}
