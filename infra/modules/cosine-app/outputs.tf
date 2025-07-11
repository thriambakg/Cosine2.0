# Outputs for Cosine App Module

output "lambda_function_names" {
  description = "Names of Lambda functions to update"
  value = [
    aws_lambda_function.portfolio_stats.function_name,
    aws_lambda_function.robinhood_integration.function_name,
  ]
}

output "api_gateway_url" {
  description = "API Gateway URL"
  value       = "https://${aws_api_gateway_rest_api.robinhood_api.id}.execute-api.${data.aws_region.current.name}.amazonaws.com/${aws_api_gateway_stage.robinhood_stage.stage_name}"
}

output "robinhood_api_url" {
  description = "URL for the Robinhood integration API"
  value       = "https://${aws_api_gateway_rest_api.robinhood_api.id}.execute-api.${data.aws_region.current.name}.amazonaws.com/${aws_api_gateway_stage.robinhood_stage.stage_name}/robinhood"
}

output "robinhood_lambda_function_name" {
  description = "Name of the Robinhood integration Lambda function"
  value       = aws_lambda_function.robinhood_integration.function_name
}

output "portfolio_stats_lambda_function_name" {
  description = "Name of the Portfolio Statistics Lambda function"
  value       = aws_lambda_function.portfolio_stats.function_name
}

output "api_gateway_rest_api_id" {
  description = "ID of the API Gateway REST API"
  value       = aws_api_gateway_rest_api.robinhood_api.id
}

output "lambda_role_arn" {
  description = "ARN of the Lambda execution role"
  value       = aws_iam_role.lambda_role.arn
}
