# outputs.tf
# Output values from the Terraform configuration

# VPC Outputs - DISABLED FOR CLOUDFRONT DEPLOYMENT
# CloudFront + S3 static hosting doesn't use VPC resources
# output "vpc_id" {
#   description = "ID of the VPC"
#   value       = module.vpc.vpc_id
# }

# output "public_subnet_ids" {
#   description = "IDs of the public subnets"
#   value       = module.vpc.public_subnet_ids
# }

# output "private_subnet_ids" {
#   description = "IDs of the private subnets"
#   value       = module.vpc.private_subnet_ids
# }

output "cloudfront_domain_name" {
  description = "Domain name of the CloudFront distribution"
  value       = var.use_cloudfront_deployment ? module.cloudfront[0].distribution_domain_name : null
}

output "waf_arn" {
  description = "ARN of the WAF Web ACL"
  value       = var.use_cloudfront_deployment ? module.cloudfront[0].web_acl_arn : null
}

# ============================================================================
# WEBSITE URL OUTPUTS
# URLs for accessing the live website in staging and production
# ============================================================================

# CloudFront distribution URL (for static hosting)
output "cloudfront_url" {
  description = "CloudFront distribution URL for the static website"
  value       = var.use_cloudfront_deployment ? "https://${module.cloudfront[0].distribution_domain_name}" : null
}

# Custom domain URL (if custom domain is enabled with CloudFront)
output "custom_domain_url" {
  description = "Custom domain URL for the static website"
  value       = var.enable_custom_domain && var.use_cloudfront_deployment && length(var.cloudfront_aliases) > 0 ? "https://${var.cloudfront_aliases[0]}" : null
}

# Primary frontend URL (prefers custom domain, falls back to CloudFront)
output "frontend_url" {
  description = "Primary URL to access the frontend application"
  value = var.use_cloudfront_deployment ? (
    var.enable_custom_domain && length(var.cloudfront_aliases) > 0 ?
    "https://${var.cloudfront_aliases[0]}" :
    "https://${module.cloudfront[0].distribution_domain_name}"
  ) : null
}

output "s3_bucket_arn" {
  description = "ARN of the S3 bucket"
  value       = data.aws_s3_bucket.static_hosting.arn
}

output "s3_bucket_domain_name" {
  description = "Domain name of the S3 bucket"
  value       = data.aws_s3_bucket.static_hosting.bucket_regional_domain_name
}

# KMS Outputs
output "kms_key_id" {
  description = "ID of the KMS key"
  value       = aws_kms_key.main.key_id
}

output "kms_key_arn" {
  description = "ARN of the KMS key"
  value       = aws_kms_key.main.arn
}

output "kms_alias_name" {
  description = "Name of the KMS alias"
  value       = aws_kms_alias.main.name
}

# Lambda Function Outputs - DISABLED FOR CLOUDFRONT DEPLOYMENT
# Stock Volatility Lambda module is disabled to reduce costs and simplify architecture
# output "stock_volatility_lambda" {
#   description = "Information about the stock volatility Lambda function"
#   value = length(module.stock_volatility_lambda) > 0 ? {
#     function_name = module.stock_volatility_lambda[0].function_name
#     function_arn  = module.stock_volatility_lambda[0].function_arn
#     invoke_arn    = module.stock_volatility_lambda[0].invoke_arn
#     role_arn      = module.stock_volatility_lambda[0].execution_role_arn
#     role_name     = module.stock_volatility_lambda[0].execution_role_name
#     } : {
#     function_name = null
#     function_arn  = null
#     invoke_arn    = null
#     role_arn      = null
#     role_name     = null
#     status        = "Disabled - IAM permissions required"
#   }
# }

# CloudFront Outputs (disabled)
# output "cloudfront_distribution_id" {
#   description = "ID of the CloudFront distribution"
#   value       = var.enable_cloudfront && var.enable_s3_bucket ? module.cloudfront[0].distribution_id : null
# }

# output "cloudfront_distribution_arn" {
#   description = "ARN of the CloudFront distribution"
#   value       = var.enable_cloudfront && var.enable_s3_bucket ? module.cloudfront[0].distribution_arn : null
# }

# output "cloudfront_domain_name" {
#   description = "Domain name of the CloudFront distribution"
#   value       = var.enable_cloudfront && var.enable_s3_bucket ? module.cloudfront[0].distribution_domain_name : null
# }

# output "cloudfront_hosted_zone_id" {
#   description = "Route 53 hosted zone ID for the CloudFront distribution"
#   value       = var.enable_cloudfront && var.enable_s3_bucket ? module.cloudfront[0].distribution_hosted_zone_id : null
# }

# Summary Output
output "deployment_summary" {
  description = "Summary of deployed resources"
  value = {
    project_name       = var.project_name
    environment        = var.environment
    aws_region         = var.aws_region
    s3_enabled         = var.enable_s3_bucket
    cloudfront_enabled = var.enable_cloudfront
    lambda_functions   = ["stock-volatility"]
    frontend_url       = var.enable_s3_bucket ? "S3 bucket created (CloudFront disabled)" : null
  }
}

# ============================================================================
# AUTHENTICATION & DATABASE INTEGRATION OUTPUTS
# ============================================================================

# Authentication Configuration from Base Infrastructure
output "authentication_config" {
  description = "Authentication configuration for frontend integration"
  value = {
    user_pool_id = local.auth_config.user_pool_id
    client_id    = local.auth_config.client_id
    domain_name  = local.auth_config.domain_name
    full_domain  = local.auth_config.full_domain_url
    region       = var.aws_region
    environment  = var.environment
  }
}

# Database Configuration from Base Infrastructure  
output "database_config" {
  description = "DynamoDB table configuration for frontend integration"
  value = {
    user_profiles_table   = local.database_config.user_profiles_table_name
    security_events_table = local.database_config.security_events_table_name
    user_sessions_table   = local.database_config.user_sessions_table_name
    region                = var.aws_region
    environment           = var.environment
  }
}

# Resource Discovery Debug Information
output "resource_discovery_debug" {
  description = "Debug information about resource discovery"
  value       = local.discovery_status
}

# Frontend Application Integration Guide
output "integration_guide" {
  description = "Integration guide for frontend developers"
  value = {
    message = <<-EOT
      ========================================================================================
      🚀 FRONTEND INTEGRATION READY!
      ========================================================================================
      
      Your frontend application is now configured with:
      
      ✅ AWS Cognito Authentication:
         - User Pool ID: ${try(data.terraform_remote_state.base_infra.outputs.cognito_user_pool_id, var.cognito_user_pool_id)}
         - Client ID: ${try(data.terraform_remote_state.base_infra.outputs.cognito_user_pool_client_id, var.cognito_client_id)}
         - Domain: ${try(data.terraform_remote_state.base_infra.outputs.cognito_user_pool_domain, var.cognito_domain)}
         - Supports: Username/Password + Google OAuth + Microsoft OAuth
      
      ✅ DynamoDB User Data Storage:
         - User Profiles: ${try(data.terraform_remote_state.base_infra.outputs.user_profiles_table_name, var.user_profiles_table_name)}
         - Security Events: ${try(data.terraform_remote_state.base_infra.outputs.security_events_table_name, var.security_events_table_name)}
         - User Sessions: ${try(data.terraform_remote_state.base_infra.outputs.user_sessions_table_name, var.user_sessions_table_name)}
      
      ✅ CloudFront Static Website Deployment:
         - Frontend URL: ${var.use_cloudfront_deployment ? (length(var.cloudfront_aliases) > 0 ? "https://${var.cloudfront_aliases[0]}" : "https://${module.cloudfront[0].distribution_domain_name}") : "CloudFront deployment not enabled"}
         - S3 Bucket: ${data.aws_s3_bucket.static_hosting.id}
      
      🔧 Next Steps:
      1. Build your Next.js application with environment variables from build_environment_variables output
      2. Deploy static files to S3 bucket: ${data.aws_s3_bucket.static_hosting.id}
      3. Use the Cognito configuration for user authentication
      4. Implement sign-in UI with federated provider options
      
      📚 Environment Variables Available at Build Time:
         - NEXT_PUBLIC_COGNITO_USER_POOL_ID
         - NEXT_PUBLIC_COGNITO_CLIENT_ID
         - NEXT_PUBLIC_COGNITO_DOMAIN
         - NEXT_PUBLIC_USER_PROFILES_TABLE
         - NEXT_PUBLIC_SECURITY_EVENTS_TABLE
         - NEXT_PUBLIC_USER_SESSIONS_TABLE
      ========================================================================================
    EOT
  }
}

# ============================================================================
# DOMAIN CONFIGURATION OUTPUTS
# Information about custom domain setup and DNS configuration
# ============================================================================

output "domain_configuration" {
  description = "Domain configuration information"
  value = var.enable_custom_domain ? {
    enabled                = true
    domain_name            = module.domain[0].domain_name
    full_domain_name       = length(var.cloudfront_aliases) > 0 ? var.cloudfront_aliases[0] : null
    website_url            = length(var.cloudfront_aliases) > 0 ? "https://${var.cloudfront_aliases[0]}" : null
    hosted_zone_id         = module.domain[0].hosted_zone_id
    certificate_arn        = module.domain[0].certificate_arn
    name_servers           = module.domain[0].hosted_zone_name_servers
    dns_setup_required     = var.use_cloudfront_deployment
    dns_setup_instructions = var.use_cloudfront_deployment && length(var.cloudfront_aliases) > 0 ? "Create a CNAME record pointing ${var.cloudfront_aliases[0]} to ${module.cloudfront[0].distribution_domain_name}" : var.use_cloudfront_deployment ? "Configure DNS for CloudFront distribution: ${module.cloudfront[0].distribution_domain_name}" : "Configure DNS for your hosting method"
    message                = "Custom domain configured successfully"
    } : {
    enabled                = false
    domain_name            = null
    full_domain_name       = null
    website_url            = null
    hosted_zone_id         = null
    certificate_arn        = null
    name_servers           = []
    dns_setup_required     = false
    dns_setup_instructions = null
    message                = "Custom domain not enabled. Set enable_custom_domain = true and provide domain_name to enable."
  }
}

# Website Access Information
output "website_access_info" {
  description = "Information about accessing the deployed website"
  value = var.use_cloudfront_deployment ? (
    length(var.cloudfront_aliases) > 0 ? join("\n", [
      "🌐 Your static website is live at: https://${var.cloudfront_aliases[0]}",
      "☁️  CloudFront URL: https://${module.cloudfront[0].distribution_domain_name}",
      "⚙️  DNS Setup: Point your domain CNAME to the CloudFront distribution"
      ]) : join("\n", [
      "🌐 Your static website is live at: https://${module.cloudfront[0].distribution_domain_name}",
      "💡 To use a custom domain, add it to cloudfront_aliases variable"
    ])
  ) : "CloudFront deployment not enabled. Set use_cloudfront_deployment = true to deploy static website."
}

# ============================================================================
# CLOUDFRONT + S3 STATIC HOSTING OUTPUTS
# ============================================================================

# CloudFront distribution for static hosting
output "cloudfront_distribution_id" {
  description = "ID of the CloudFront distribution"
  value       = var.use_cloudfront_deployment ? module.cloudfront[0].distribution_id : null
}

output "cloudfront_distribution_domain_name" {
  description = "Domain name of the CloudFront distribution"
  value       = var.use_cloudfront_deployment ? module.cloudfront[0].distribution_domain_name : null
}

output "cloudfront_distribution_arn" {
  description = "ARN of the CloudFront distribution"
  value       = var.use_cloudfront_deployment ? module.cloudfront[0].distribution_arn : null
}

# S3 bucket outputs
output "s3_bucket_name" {
  description = "Name of the S3 bucket for static hosting"
  value       = data.aws_s3_bucket.static_hosting.id
}

# Legacy output name for backward compatibility with GitHub Actions
output "frontend_s3_bucket_name" {
  description = "Name of the S3 bucket for static hosting (legacy name for GitHub Actions compatibility)"
  value       = data.aws_s3_bucket.static_hosting.id
}

output "s3_website_endpoint" {
  description = "S3 website endpoint"
  value       = data.aws_s3_bucket.static_hosting.website_endpoint
}

# Environment variables for build-time injection
output "build_environment_variables" {
  description = "Environment variables needed for Next.js build process"
  value = {
    # Authentication configuration
    NEXT_PUBLIC_COGNITO_USER_POOL_ID        = local.auth_config.user_pool_id
    NEXT_PUBLIC_COGNITO_CLIENT_ID           = local.auth_config.client_id
    NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID = local.auth_config.client_id # Legacy name for GitHub Actions compatibility
    NEXT_PUBLIC_COGNITO_DOMAIN              = "cosine-production.auth.us-east-1.amazoncognito.com"
    NEXT_PUBLIC_AWS_REGION                  = var.aws_region

    # API Gateway URL
    NEXT_PUBLIC_API_GATEWAY_URL = var.api_gateway_url

    # DynamoDB table names (for client-side reference if needed)
    NEXT_PUBLIC_USER_PROFILES_TABLE   = local.database_config.user_profiles_table_name
    NEXT_PUBLIC_SECURITY_EVENTS_TABLE = local.database_config.security_events_table_name
    NEXT_PUBLIC_USER_SESSIONS_TABLE   = local.database_config.user_sessions_table_name

    # Environment information
    NEXT_PUBLIC_ENVIRONMENT  = var.environment
    NEXT_PUBLIC_PROJECT_NAME = var.project_name

    # OAuth redirect URLs (construct from CloudFront domain or custom domain)
    NEXT_PUBLIC_REDIRECT_SIGN_IN = var.use_cloudfront_deployment ? (
      length(var.cloudfront_aliases) > 0 ?
      "https://${var.cloudfront_aliases[0]}/dashboard" :
      "https://${module.cloudfront[0].distribution_domain_name}/dashboard"
    ) : null

    NEXT_PUBLIC_REDIRECT_SIGN_OUT = var.use_cloudfront_deployment ? (
      length(var.cloudfront_aliases) > 0 ?
      "https://${var.cloudfront_aliases[0]}/" :
      "https://${module.cloudfront[0].distribution_domain_name}/"
    ) : null
  }
}

# Deployment mode information
output "deployment_mode" {
  description = "Current deployment mode"
  value       = "CloudFront + S3 Static Hosting"
}

output "website_urls" {
  description = "Primary website access URLs"
  value = var.use_cloudfront_deployment ? {
    cloudfront_url = "https://${module.cloudfront[0].distribution_domain_name}"
    custom_domain  = length(var.cloudfront_aliases) > 0 ? "https://${var.cloudfront_aliases[0]}" : null
    } : {
    message = "CloudFront deployment not enabled. Set use_cloudfront_deployment = true to deploy static website."
  }
}
