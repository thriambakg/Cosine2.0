# Production Environment Configuration
# environments/production.auto.tfvars

# Basic configuration
project_name = "cosine"
environment  = "production"
aws_region   = "us-east-1"

# Feature flags (production ready)
enable_s3_bucket  = true # Enable for production hosting
enable_cloudfront = true # Enable for global distribution

# WAF Configuration (production security)
waf_rate_limit        = 1000               # More restrictive rate limit for production
waf_blocked_countries = ["CN", "RU", "KP"] # Block high-risk countries for production

# CloudFront Configuration
# Note: Both domains use unified certificate (when validated) or fingov.ai certificate (fallback)
cloudfront_aliases        = ["fingov.ai", "www.fingov.ai", "investcosine.com", "www.investcosine.com"] # Custom domains for CloudFront
use_cloudfront_deployment = true                                                                       # Enable CloudFront + S3 static hosting

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



# ============================================================================
# CUSTOM DOMAIN CONFIGURATION (Production Ready)
# Set up custom domain for professional website URLs
# ============================================================================

# Enable custom domain (true for production to use professional domain)
enable_custom_domain = true

# Your domain name (e.g., "mycompany.com" or "cosineapp.com")
domain_name = "fingov.ai" # Your new production domain

# Staging subdomain (will create staging.your-domain.com)
staging_subdomain = "staging"

# Production subdomain (empty string = root domain, or set to "app", "www", etc.)
production_subdomain = ""

# Chat Agent Container Configuration
# Use dynamic versioned tags from build process for production deployments
# chat_agent_image_tag = "v1.0.0"  # Commented out - will use dynamic tag from build process

# Lambda Concurrency Configuration (production)
lambda_provisioned_concurrency_default = 2    # Provisioned concurrency for chat agent to reduce cold starts
lambda_reserved_concurrency_default    = null # Unlimited concurrency in production (no throttling)

# Note: When enabling custom domain in production:
# 1. Purchase and register your domain (fingov.ai) ✅ DONE
# 2. After terraform apply, update your domain's nameservers to Route53
# 3. Production URL will be: https://fingov.ai
# 4. Certificate will be automatically managed by AWS ACM
