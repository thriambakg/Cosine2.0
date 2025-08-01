# Production Environment Configuration
# environments/production.auto.tfvars

# Basic configuration
project_name = "cosine"
environment  = "production"
aws_region   = "us-east-1"

# Feature flags (production ready)
enable_s3_bucket  = true # Enable for production hosting
enable_cloudfront = true # Enable for global distribution

# Common tags
common_tags = {
  Project     = "cosine"
  Environment = "production"
  Owner       = "team"
  ManagedBy   = "terraform"
  Repository  = "Cosine2.0"
  CostCenter  = "production"
  LastUpdated = "2025-08-01T05:00:00Z"
}
