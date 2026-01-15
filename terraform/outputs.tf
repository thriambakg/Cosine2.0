# outputs.tf
# Output values from the Terraform configuration

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

# KMS Outputs - Using base infrastructure KMS key
output "kms_key_arn" {
  description = "ARN of the KMS key from base infrastructure"
  value       = local.kms_key_arn
}

# ============================================================================
# MINIMAL BACKEND API INFRASTRUCTURE OUTPUTS
# ============================================================================

# API Gateway Outputs
output "api_gateway" {
  description = "API Gateway configuration"
  value = {
    rest_api_id = module.api_gateway.rest_api_id
    api_name    = "cosine-api-${var.environment}"
    api_url     = "https://${module.api_gateway.rest_api_id}.execute-api.${var.aws_region}.amazonaws.com"
    stage_url   = module.api_gateway.stage_url
  }
}

# Stock Volatility Lambda Function Outputs
output "stock_volatility_lambda" {
  description = "Information about the stock volatility Lambda function"
  value = {
    function_name = module.stock_volatility_lambda.function_name
    function_arn  = module.stock_volatility_lambda.function_arn
    invoke_arn    = module.stock_volatility_lambda.invoke_arn
    role_arn      = module.stock_volatility_lambda.execution_role_arn
    role_name     = module.stock_volatility_lambda.execution_role_name
  }
}

# API Endpoints
output "api_endpoints" {
  description = "Available API endpoints"
  value = {
    stock_volatility_endpoint = "${module.api_gateway.stage_url}/volatility"
    chat_endpoint             = "${module.api_gateway.stage_url}/chat"
  }
}

# WebSocket API Gateway Outputs
output "websocket_api" {
  description = "WebSocket API Gateway configuration"
  value = {
    api_id            = module.websocket_api.api_id
    api_arn           = module.websocket_api.api_arn
    api_execution_arn = module.websocket_api.api_execution_arn
    stage_url         = module.websocket_api.stage_url
    deployment_id     = module.websocket_api.deployment_id
    stage_name        = module.websocket_api.stage_name
  }
}

# WebSocket Lambda Function Outputs
output "websocket_connection_lambda" {
  description = "Information about the WebSocket connection manager Lambda function"
  value = {
    function_name = module.websocket_connection_lambda.function_name
    function_arn  = module.websocket_connection_lambda.function_arn
    invoke_arn    = module.websocket_connection_lambda.invoke_arn
    role_arn      = module.websocket_connection_lambda.execution_role_arn
    role_name     = module.websocket_connection_lambda.execution_role_name
  }
}

output "websocket_message_lambda" {
  description = "Information about the WebSocket message processor (consolidated into chat_agent)"
  value = {
    function_name = aws_lambda_function.chat_agent.function_name
    function_arn  = aws_lambda_function.chat_agent.arn
    invoke_arn    = aws_lambda_function.chat_agent.invoke_arn
    role_arn      = aws_iam_role.chat_agent_execution_role.arn
    role_name     = aws_iam_role.chat_agent_execution_role.name
    note          = "WebSocket message processing is now handled by the chat_agent Lambda function"
  }
}

# Chat Agent Lambda Function Outputs
output "chat_agent_lambda" {
  description = "Information about the chat agent Lambda function"
  value = {
    function_name           = aws_lambda_function.chat_agent.function_name
    function_arn            = aws_lambda_function.chat_agent.arn
    invoke_arn              = aws_lambda_function.chat_agent.invoke_arn
    role_arn                = aws_iam_role.chat_agent_execution_role.arn
    role_name               = aws_iam_role.chat_agent_execution_role.name
    memory_size             = 1536
    provisioned_concurrency = 0 # Removed for now
  }
}

# Stock Data Lambda Function
output "stock_data_lambda" {
  description = "Information about the stock data Lambda function"
  value = {
    function_name = module.stock_data_lambda.function_name
    function_arn  = module.stock_data_lambda.function_arn
    invoke_arn    = module.stock_data_lambda.invoke_arn
  }
}

# Stock Statistics Lambda Function
output "stock_statistics_lambda" {
  description = "Information about the stock statistics Lambda function"
  value = {
    function_name = module.stock_statistics_lambda.function_name
    function_arn  = module.stock_statistics_lambda.function_arn
    invoke_arn    = module.stock_statistics_lambda.invoke_arn
  }
}

# Volatility Fetch Lambda Function
output "volatility_fetch_lambda" {
  description = "Information about the volatility fetch Lambda function"
  value = {
    function_name = module.volatility_fetch_lambda.function_name
    function_arn  = module.volatility_fetch_lambda.function_arn
    invoke_arn    = module.volatility_fetch_lambda.invoke_arn
  }
}

# Summary Output
output "deployment_summary" {
  description = "Summary of deployed resources"
  value = {
    project_name        = var.project_name
    environment         = var.environment
    aws_region          = var.aws_region
    s3_enabled          = var.enable_s3_bucket
    cloudfront_enabled  = var.enable_cloudfront
    api_gateway_enabled = true
    lambda_functions = [
      "stock-volatility"
    ]
    api_base_url = module.api_gateway.stage_url
    frontend_url = var.enable_s3_bucket ? "S3 bucket created (CloudFront disabled)" : null
  }
}

# ============================================================================
# AUTHENTICATION & DATABASE INTEGRATION OUTPUTS
# ============================================================================

# Authentication Configuration from Base Infrastructure
output "authentication_config" {
  description = "Authentication configuration for frontend integration"
  value = {
    user_pool_id = try(data.terraform_remote_state.base_infra.outputs.cognito_user_pool_id, "not_configured")
    client_id    = try(data.terraform_remote_state.base_infra.outputs.cognito_user_pool_client_id, "not_configured")
    domain_name  = try(data.terraform_remote_state.base_infra.outputs.cognito_user_pool_domain, "not_configured")
    full_domain  = try(data.terraform_remote_state.base_infra.outputs.cognito_user_pool_domain, "not_configured") != "not_configured" ? "${try(data.terraform_remote_state.base_infra.outputs.cognito_user_pool_domain, "")}.auth.${var.aws_region}.amazoncognito.com" : "not_configured"
    region       = var.aws_region
    environment  = var.environment
  }
}

# Database Configuration from Base Infrastructure  
output "database_config" {
  description = "DynamoDB table configuration for frontend integration"
  value = {
    user_profiles_table   = try(data.terraform_remote_state.base_infra.outputs.user_profiles_table_name, "not_configured")
    security_events_table = try(data.terraform_remote_state.base_infra.outputs.security_events_table_name, "not_configured")
    user_sessions_table   = try(data.terraform_remote_state.base_infra.outputs.user_sessions_table_name, "not_configured")
    region                = var.aws_region
    environment           = var.environment
  }
}

# Frontend Application Integration Guide
output "integration_guide" {
  description = "Integration guide for frontend developers"
  value = {
    message = <<-EOT
      ========================================================================================
      🚀 MINIMAL BACKEND DEPLOYMENT READY!
      ========================================================================================
      
      Your frontend application is now configured with:
      
             ✅ Stock Volatility API:
          - Endpoint: ${module.api_gateway.stage_url}/stocks/volatility
         - Method: GET
         - Parameters: ticker (query param), period (query param)
      
      ✅ AWS Cognito Authentication (if base infrastructure exists):
         - User Pool ID: ${try(data.terraform_remote_state.base_infra.outputs.cognito_user_pool_id, "not_configured")}
         - Client ID: ${try(data.terraform_remote_state.base_infra.outputs.cognito_user_pool_client_id, "not_configured")}
      
      ✅ CloudFront Static Website Deployment:
         - Frontend URL: ${var.use_cloudfront_deployment ? (length(var.cloudfront_aliases) > 0 ? "https://${var.cloudfront_aliases[0]}" : "https://${module.cloudfront[0].distribution_domain_name}") : "CloudFront deployment not enabled"}
         - S3 Bucket: ${data.aws_s3_bucket.static_hosting.id}
      
      🔧 Next Steps:
      1. Test the stock volatility API endpoint
      2. Deploy your frontend to S3 bucket: ${data.aws_s3_bucket.static_hosting.id}
      3. Configure frontend to use the API endpoint
      
      💰 Cost Estimate: ~$15-25/month for this minimal setup
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
    NEXT_PUBLIC_COGNITO_USER_POOL_ID        = try(data.terraform_remote_state.base_infra.outputs.cognito_user_pool_id, "not_configured")
    NEXT_PUBLIC_COGNITO_CLIENT_ID           = try(data.terraform_remote_state.base_infra.outputs.cognito_user_pool_client_id, "not_configured")
    NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID = try(data.terraform_remote_state.base_infra.outputs.cognito_user_pool_client_id, "not_configured") # Legacy name for GitHub Actions compatibility
    NEXT_PUBLIC_COGNITO_DOMAIN              = try(data.terraform_remote_state.base_infra.outputs.cognito_user_pool_domain, "not_configured") != "not_configured" ? "${try(data.terraform_remote_state.base_infra.outputs.cognito_user_pool_domain, "")}.auth.${var.aws_region}.amazoncognito.com" : "not_configured"
    NEXT_PUBLIC_AWS_REGION                  = var.aws_region

    # API Gateway URL
    NEXT_PUBLIC_API_GATEWAY_URL = module.api_gateway.stage_url

    # DynamoDB table names (for client-side reference if needed)
    NEXT_PUBLIC_USER_PROFILES_TABLE   = try(data.terraform_remote_state.base_infra.outputs.user_profiles_table_name, "not_configured")
    NEXT_PUBLIC_SECURITY_EVENTS_TABLE = try(data.terraform_remote_state.base_infra.outputs.security_events_table_name, "not_configured")
    NEXT_PUBLIC_USER_SESSIONS_TABLE   = try(data.terraform_remote_state.base_infra.outputs.user_sessions_table_name, "not_configured")

    # Environment information
    NEXT_PUBLIC_ENVIRONMENT  = var.environment
    NEXT_PUBLIC_PROJECT_NAME = var.project_name

    # OAuth redirect URLs (construct from CloudFront domain or custom domain)
    NEXT_PUBLIC_REDIRECT_SIGN_IN = var.use_cloudfront_deployment ? (
      length(var.cloudfront_aliases) > 0 ?
      "https://${var.cloudfront_aliases[0]}/auth/callback" :
      "https://${module.cloudfront[0].distribution_domain_name}/auth/callback"
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
  value       = "Minimal Backend + CloudFront + S3 Static Hosting"
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
