# outputs.tf
# Output values from the Terraform configuration

# VPC Outputs
output "vpc_id" {
  description = "ID of the VPC"
  value       = module.vpc.vpc_id
}

output "public_subnet_ids" {
  description = "IDs of the public subnets"
  value       = module.vpc.public_subnet_ids
}

output "private_subnet_ids" {
  description = "IDs of the private subnets"
  value       = module.vpc.private_subnet_ids
}

# ECR Outputs
output "ecr_repository_url" {
  description = "URL of the ECR repository"
  value       = module.ecr.repository_url
}

output "ecr_repository_name" {
  description = "Name of the ECR repository"
  value       = module.ecr.repository_name
}

# ALB Outputs
output "alb_dns_name" {
  description = "DNS name of the Application Load Balancer"
  value       = module.alb.alb_dns_name
}

output "alb_zone_id" {
  description = "Zone ID of the Application Load Balancer"
  value       = module.alb.alb_zone_id
}

output "waf_arn" {
  description = "ARN of the WAF Web ACL"
  value       = module.alb.waf_arn
}

# ECS Outputs
output "ecs_cluster_id" {
  description = "ID of the ECS cluster"
  value       = module.ecs.cluster_id
}

output "ecs_service_name" {
  description = "Name of the ECS service"
  value       = module.ecs.service_name
}

# ============================================================================
# WEBSITE URL OUTPUTS
# URLs for accessing the live website in staging and production
# ============================================================================

# ALB DNS URL (always available)
output "alb_dns_url" {
  description = "Direct ALB DNS URL for the frontend application"
  value       = var.certificate_arn != "" || var.enable_custom_domain ? "https://${module.alb.alb_dns_name}" : "http://${module.alb.alb_dns_name}"
}

# Custom domain URL (if custom domain is enabled)
output "custom_domain_url" {
  description = "Custom domain URL for the frontend application"
  value       = var.enable_custom_domain ? module.domain_records[0].website_url : null
}

# Primary frontend URL (prefers custom domain, falls back to ALB DNS)
output "frontend_url" {
  description = "Primary URL to access the frontend application"
  value       = var.enable_custom_domain ? module.domain_records[0].website_url : (var.certificate_arn != "" ? "https://${module.alb.alb_dns_name}" : "http://${module.alb.alb_dns_name}")
}

# S3 Bucket Outputs (existing)
output "s3_bucket_name" {
  description = "Name of the S3 bucket"
  value       = length(module.s3_buckets) > 0 ? module.s3_buckets[0].frontend_bucket_id : null
}

output "s3_bucket_arn" {
  description = "ARN of the S3 bucket"
  value       = length(module.s3_buckets) > 0 ? module.s3_buckets[0].frontend_bucket_arn : null
}

output "s3_bucket_domain_name" {
  description = "Domain name of the S3 bucket"
  value       = length(module.s3_buckets) > 0 ? module.s3_buckets[0].frontend_bucket_regional_domain_name : null
}

output "s3_logs_bucket_name" {
  description = "Name of the S3 logs bucket"
  value       = length(module.s3_buckets) > 0 ? module.s3_buckets[0].logs_bucket_id : null
}

output "s3_logs_bucket_arn" {
  description = "ARN of the S3 logs bucket"
  value       = length(module.s3_buckets) > 0 ? module.s3_buckets[0].logs_bucket_arn : null
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

# Lambda Function Outputs
output "stock_volatility_lambda" {
  description = "Information about the stock volatility Lambda function"
  value = length(module.stock_volatility_lambda) > 0 ? {
    function_name = module.stock_volatility_lambda[0].function_name
    function_arn  = module.stock_volatility_lambda[0].function_arn
    invoke_arn    = module.stock_volatility_lambda[0].invoke_arn
    role_arn      = module.stock_volatility_lambda[0].execution_role_arn
    role_name     = module.stock_volatility_lambda[0].execution_role_name
    } : {
    function_name = null
    function_arn  = null
    invoke_arn    = null
    role_arn      = null
    role_name     = null
    status        = "Disabled - IAM permissions required"
  }
}

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
    cognito_user_pool_id = try(data.terraform_remote_state.base_infra.outputs.cognito_user_pool_id, var.cognito_user_pool_id)
    cognito_client_id    = try(data.terraform_remote_state.base_infra.outputs.cognito_user_pool_client_id, var.cognito_client_id)
    cognito_domain       = try(data.terraform_remote_state.base_infra.outputs.cognito_user_pool_domain, var.cognito_domain)
    region               = var.aws_region
  }
}

# Database Configuration from Base Infrastructure  
output "database_config" {
  description = "DynamoDB table configuration for frontend integration"
  value = {
    user_profiles_table   = try(data.terraform_remote_state.base_infra.outputs.user_profiles_table_name, var.user_profiles_table_name)
    security_events_table = try(data.terraform_remote_state.base_infra.outputs.security_events_table_name, var.security_events_table_name)
    user_sessions_table   = try(data.terraform_remote_state.base_infra.outputs.user_sessions_table_name, var.user_sessions_table_name)
    region                = var.aws_region
  }
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
      
      ✅ ECS Container Deployment:
         - Frontend URL: ${var.certificate_arn != "" ? "https://${module.alb.alb_dns_name}" : "http://${module.alb.alb_dns_name}"}
         - Container Image: ${module.ecr.repository_url}:latest
      
      🔧 Next Steps:
      1. Build & push your frontend container to ECR: ${module.ecr.repository_url}
      2. Your app will have access to DynamoDB tables via environment variables
      3. Use the Cognito configuration for user authentication
      4. Implement sign-in UI with federated provider options
      
      📚 Environment Variables Available in Container:
         - NEXT_PUBLIC_COGNITO_USER_POOL_ID
         - NEXT_PUBLIC_COGNITO_CLIENT_ID
         - NEXT_PUBLIC_COGNITO_DOMAIN
         - USER_PROFILES_TABLE_NAME
         - SECURITY_EVENTS_TABLE_NAME
         - USER_SESSIONS_TABLE_NAME
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
    full_domain_name       = module.domain_records[0].full_domain_name
    website_url            = module.domain_records[0].website_url
    hosted_zone_id         = module.domain[0].hosted_zone_id
    certificate_arn        = module.domain[0].certificate_arn
    name_servers           = module.domain[0].hosted_zone_name_servers
    dns_setup_required     = true
    dns_setup_instructions = "Update your domain registrar to use these nameservers: ${join(", ", module.domain[0].hosted_zone_name_servers)}"
    } : {
    enabled = false
    message = "Custom domain not enabled. Set enable_custom_domain = true and provide domain_name to enable."
  }
}

# Website Access Information
output "website_access_info" {
  description = "Information about accessing the deployed website"
  value = var.enable_custom_domain ? join("\n", [
    "🌐 Your website will be live at: ${module.domain_records[0].website_url}",
    "⚙️  DNS Setup Required: Update your domain's nameservers to: ${join(", ", module.domain[0].hosted_zone_name_servers)}",
    "🔗 Temporary ALB URL: ${var.certificate_arn != "" || var.enable_custom_domain ? "https" : "http"}://${module.alb.alb_dns_name}"
    ]) : join("\n", [
    "🌐 Your website is live at: ${var.certificate_arn != "" ? "https" : "http"}://${module.alb.alb_dns_name}",
    "💡 To set up a custom domain, set enable_custom_domain = true and provide domain_name"
  ])
}
