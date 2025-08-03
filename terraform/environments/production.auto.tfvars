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
enable_waf_logging    = true               # Enable for production monitoring
waf_rate_limit        = 1000               # More restrictive rate limit for production
waf_blocked_countries = ["CN", "RU", "KP"] # Block high-risk countries for production

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
# AUTHENTICATION & DATABASE - Configuration from Base Infrastructure
# ============================================================================

# Cognito Configuration (retrieved from base infrastructure remote state)
# These values will be automatically populated from the base infrastructure outputs
cognito_user_pool_id = ""
cognito_client_id    = ""
cognito_domain       = ""

# DynamoDB Table Names (retrieved from base infrastructure remote state)
# These values will be automatically populated from the base infrastructure outputs
user_profiles_table_name   = ""
security_events_table_name = ""
user_sessions_table_name   = ""

# API Gateway URL (set when backend is deployed)
api_gateway_url = ""

# ============================================================================
# CUSTOM DOMAIN CONFIGURATION (Production Ready)
# Set up custom domain for professional website URLs
# ============================================================================

# Enable custom domain (true for production to use professional domain)
enable_custom_domain = true

# Your domain name (e.g., "mycompany.com" or "cosineapp.com")
domain_name = "investcosine.com" # Your new production domain

# Staging subdomain (will create staging.your-domain.com)
staging_subdomain = "staging"

# Production subdomain (empty string = root domain, or set to "app", "www", etc.)
production_subdomain = ""

# Note: When enabling custom domain in production:
# 1. Purchase and register your domain (investcosine.com) ✅ DONE
# 2. After terraform apply, update your domain's nameservers to Route53
# 3. Production URL will be: https://investcosine.com
# 4. Certificate will be automatically managed by AWS ACM
