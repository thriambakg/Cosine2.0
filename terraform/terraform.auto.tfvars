# terraform.auto.tfvars
# Variable values for the Terraform configuration

project_name = "cosine"
environment  = "staging"
aws_region   = "us-east-1"

# Enable/disable features
enable_s3_bucket   = false
enable_cloudfront  = false  # Disabled as requested

# CloudFront configuration (for future use)
cloudfront_aliases = []
# acm_certificate_arn = "arn:aws:acm:us-east-1:ACCOUNT:certificate/CERTIFICATE_ID"

# Common tags for all resources
common_tags = {
  Project     = "cosine"
  Environment = "staging"
  Owner       = "team"
  ManagedBy   = "terraform"
  Repository  = "Cosine2.0"
}
