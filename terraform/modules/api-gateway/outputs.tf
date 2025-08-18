# API Gateway Module Outputs
# modules/api-gateway/outputs.tf

output "rest_api_id" {
  description = "ID of the REST API"
  value       = aws_api_gateway_rest_api.this.id
}

output "rest_api_arn" {
  description = "ARN of the REST API"
  value       = aws_api_gateway_rest_api.this.arn
}

output "rest_api_execution_arn" {
  description = "Execution ARN of the REST API"
  value       = aws_api_gateway_rest_api.this.execution_arn
}

output "stage_url" {
  description = "URL of the API Gateway stage"
  value       = aws_api_gateway_stage.this.invoke_url
}

output "deployment_id" {
  description = "ID of the API Gateway deployment"
  value       = aws_api_gateway_deployment.this.id
}

output "stage_name" {
  description = "Name of the API Gateway stage"
  value       = aws_api_gateway_stage.this.stage_name
}

output "cloudwatch_log_group_name" {
  description = "Name of the CloudWatch log group for API Gateway"
  value       = aws_cloudwatch_log_group.api_gateway.name
}

output "cloudwatch_log_group_arn" {
  description = "ARN of the CloudWatch log group for API Gateway"
  value       = aws_cloudwatch_log_group.api_gateway.arn
}

# Custom Domain Outputs
output "domain_name" {
  description = "Custom domain name"
  value       = var.domain_name != null ? aws_api_gateway_domain_name.this[0].domain_name : null
}

output "domain_name_cloudfront_domain_name" {
  description = "CloudFront domain name for the custom domain"
  value       = var.domain_name != null ? aws_api_gateway_domain_name.this[0].cloudfront_domain_name : null
}

output "domain_name_cloudfront_zone_id" {
  description = "CloudFront zone ID for the custom domain"
  value       = var.domain_name != null ? aws_api_gateway_domain_name.this[0].cloudfront_zone_id : null
}

output "domain_name_regional_domain_name" {
  description = "Regional domain name for the custom domain"
  value       = var.domain_name != null ? aws_api_gateway_domain_name.this[0].regional_domain_name : null
}

output "domain_name_regional_zone_id" {
  description = "Regional zone ID for the custom domain"
  value       = var.domain_name != null ? aws_api_gateway_domain_name.this[0].regional_zone_id : null
}

# Usage Plan and API Keys
output "usage_plan_id" {
  description = "ID of the usage plan"
  value       = var.create_usage_plan ? aws_api_gateway_usage_plan.this[0].id : null
}

output "usage_plan_arn" {
  description = "ARN of the usage plan"
  value       = var.create_usage_plan ? aws_api_gateway_usage_plan.this[0].arn : null
}

output "api_key_ids" {
  description = "Map of API key names to their IDs"
  value       = { for k, v in aws_api_gateway_api_key.this : k => v.id }
}

output "api_key_values" {
  description = "Map of API key names to their values"
  value       = { for k, v in aws_api_gateway_api_key.this : k => v.value }
  sensitive   = true
}

# IAM Role Outputs
output "cloudwatch_role_arn" {
  description = "ARN of the CloudWatch IAM role"
  value       = var.create_api_gateway_account ? aws_iam_role.api_gateway_cloudwatch[0].arn : null
}

# WAF Association - temporarily disabled
# output "waf_web_acl_association_id" {
#   description = "ID of the WAF Web ACL association"
#   value       = var.waf_web_acl_arn != null && var.create_deployment ? aws_wafv2_web_acl_association.this[0].id : null
# }

# CORS Configuration Outputs
output "cors_enabled" {
  description = "Whether CORS is enabled for this API Gateway"
  value       = var.enable_cors
}

output "cors_allowed_origins" {
  description = "List of allowed origins for CORS"
  value       = var.cors_allowed_origins
}

output "cors_allowed_methods" {
  description = "List of allowed HTTP methods for CORS"
  value       = var.cors_allowed_methods
}

output "cors_allowed_headers" {
  description = "List of allowed headers for CORS"
  value       = var.cors_allowed_headers
}

output "cors_max_age" {
  description = "Maximum age for CORS preflight requests in seconds"
  value       = var.cors_max_age
}
