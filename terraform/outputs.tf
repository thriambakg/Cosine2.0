# outputs.tf
# Output values from the Terraform configuration

# S3 Bucket Outputs
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
    function_name    = module.stock_volatility_lambda.function_name
    function_arn     = module.stock_volatility_lambda.function_arn
    invoke_arn       = module.stock_volatility_lambda.function_invoke_arn
    role_arn         = module.stock_volatility_lambda.role_arn
    log_group_name   = module.stock_volatility_lambda.log_group_name
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
