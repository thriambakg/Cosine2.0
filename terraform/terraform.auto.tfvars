# terraform.auto.tfvars
# Variable values for the Terraform configuration

project_name = "cosine"
environment  = "staging"
aws_region   = "us-east-1"

# Enable/disable features
enable_s3_bucket  = false
enable_cloudfront = false # Disabled as requested


# Common tags for all resources
common_tags = {
  Project     = "cosine"
  Environment = "staging"
  Owner       = "team"
  ManagedBy   = "terraform"
  Repository  = "Cosine2.0"
  LastUpdated = "2025-07-28T12:00:00Z"
}
