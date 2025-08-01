# Staging Environment Configuration
# environments/staging.auto.tfvars

# Basic configuration
project_name = "cosine"
environment  = "staging"
aws_region   = "us-east-1"

# Feature flags (staging environment)
enable_s3_bucket  = true # Enable for pre-production testing
enable_cloudfront = true # Enable for performance testing

# Common tags
common_tags = {
  Project     = "cosine"
  Environment = "staging"
  Owner       = "team"
  ManagedBy   = "terraform"
  Repository  = "Cosine2.0"
  CostCenter  = "staging"
  LastUpdated = "2025-08-01T05:00:00Z"
}
