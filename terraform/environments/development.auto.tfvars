# Development Environment Configuration
# environments/development.auto.tfvars

# Basic configuration
project_name = "cosine"
environment  = "development"
aws_region   = "us-east-1"

# Feature flags (development-friendly)
enable_s3_bucket  = true  # Enable for testing
enable_cloudfront = false # Disabled for faster iteration

# Common tags
common_tags = {
  Project     = "cosine"
  Environment = "development"
  Owner       = "team"
  ManagedBy   = "terraform"
  Repository  = "Cosine2.0"
  CostCenter  = "development"
  LastUpdated = "2025-08-01T05:00:00Z"
}

# Lambda (hibernate / dev): explicit so provisioned config is not created
lambda_reserved_concurrency_default    = null
lambda_provisioned_concurrency_default = 0
