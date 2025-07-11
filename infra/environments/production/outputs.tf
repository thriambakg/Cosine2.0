# Outputs for Production Environment

output "lambda_function_names" {
  description = "Names of Lambda functions to update"
  value       = module.cosine_app.lambda_function_names
}

output "api_gateway_url" {
  description = "API Gateway URL"
  value       = module.cosine_app.api_gateway_url
}

output "robinhood_api_url" {
  description = "URL for the Robinhood integration API"
  value       = module.cosine_app.robinhood_api_url
}

output "robinhood_lambda_function_name" {
  description = "Name of the Robinhood integration Lambda function"
  value       = module.cosine_app.robinhood_lambda_function_name
}

output "portfolio_stats_lambda_function_name" {
  description = "Name of the Portfolio Statistics Lambda function"
  value       = module.cosine_app.portfolio_stats_lambda_function_name
}

output "environment" {
  description = "Environment name"
  value       = "production"
}

output "aws_region" {
  description = "AWS region"
  value       = var.aws_region
}
