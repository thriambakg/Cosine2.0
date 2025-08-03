# Staging Environment Configuration
# environments/staging.auto.tfvars

# Basic configuration
project_name = "cosine"
environment  = "staging"
aws_region   = "us-east-1"

# Feature flags (staging environment)
enable_s3_bucket  = true # Enable for pre-production testing
enable_cloudfront = true # Enable for performance testing

# WAF Configuration
enable_waf_logging    = false # Temporarily disabled to avoid deployment issues
waf_rate_limit        = 2000  # Rate limit for staging environment
waf_blocked_countries = []    # No blocked countries for staging testing

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

# ============================================================================
# AUTHENTICATION & DATABASE - Configuration from Base Infrastructure
# ============================================================================

# Cognito Configuration (retrieved from base infrastructure remote state)
# These values will be automatically populated from the base infrastructure outputs
cognito_user_pool_id = "us-east-1_1dOeIUrQu"
cognito_client_id    = "4194qg8gsba2886u97slpab40o"
cognito_domain       = "cosine-auth-staging"

# DynamoDB Table Names (retrieved from base infrastructure remote state)
# These values will be automatically populated from the base infrastructure outputs
user_profiles_table_name   = ""
security_events_table_name = ""
user_sessions_table_name   = ""

# API Gateway URL (set when backend is deployed)
api_gateway_url = ""

# ============================================================================
# CUSTOM DOMAIN CONFIGURATION (Optional)
# Set up custom domain for professional website URLs
# ============================================================================

# Enable custom domain (set to true to use your own domain)
# DISABLED FOR STAGING - Using ALB with HTTPS certificate instead
enable_custom_domain = false

# Your domain name (e.g., "mycompany.com" or "cosineapp.com")
# Uncomment and set your domain when ready to use custom domain
domain_name = "cosinedev.com" # Replace with your actual domain

# Staging subdomain (will create staging.your-domain.com)
staging_subdomain = "staging"

# Production subdomain (empty string = root domain, or set to "app", "www", etc.)
production_subdomain = ""

# Alternative: Provide existing certificate ARN directly (if you don't want to use custom domain)
# We'll create a self-signed certificate for HTTPS to satisfy Cognito OAuth requirements
# This will be populated after we create the certificate
certificate_arn = "arn:aws:acm:us-east-1:676206904242:certificate/76a2a444-d2ac-4e24-947a-07dce59af77a"

# Note: When enabling custom domain:
# 1. Set enable_custom_domain = true
# 2. Set your domain_name = "your-domain.com"  
# 3. After terraform apply, update your domain's nameservers
# 4. Your staging URL will be: https://staging.your-domain.com
# 5. Your production URL will be: https://your-domain.com (or subdomain if set)
