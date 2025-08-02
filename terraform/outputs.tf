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

# Frontend URL
output "frontend_url" {
  description = "URL to access the frontend application"
  value       = var.certificate_arn != "" ? "https://${module.alb.alb_dns_name}" : "http://${module.alb.alb_dns_name}"
}

# S3 Bucket Outputs (existing)
output "s3_bucket_name" {
  description = "Name of the S3 bucket"
  value       = var.enable_s3_bucket ? module.s3_buckets[0].frontend_bucket_id : null
}

output "s3_bucket_arn" {
  description = "ARN of the S3 bucket"
  value       = var.enable_s3_bucket ? module.s3_buckets[0].frontend_bucket_arn : null
}

output "s3_bucket_domain_name" {
  description = "Domain name of the S3 bucket"
  value       = var.enable_s3_bucket ? module.s3_buckets[0].frontend_bucket_regional_domain_name : null
}

output "s3_logs_bucket_name" {
  description = "Name of the S3 logs bucket"
  value       = var.enable_s3_bucket ? module.s3_buckets[0].logs_bucket_id : null
}

output "s3_logs_bucket_arn" {
  description = "ARN of the S3 logs bucket"
  value       = var.enable_s3_bucket ? module.s3_buckets[0].logs_bucket_arn : null
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
  value = {
    function_name = module.stock_volatility_lambda.function_name
    function_arn  = module.stock_volatility_lambda.function_arn
    invoke_arn    = module.stock_volatility_lambda.invoke_arn
    role_arn      = module.stock_volatility_lambda.execution_role_arn
    role_name     = module.stock_volatility_lambda.execution_role_name
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
