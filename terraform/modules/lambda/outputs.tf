# modules/lambda/outputs.tf
# Output values from the Lambda module

output "function_name" {
  description = "Name of the Lambda function"
  value       = aws_lambda_function.lambda.function_name
}

output "function_arn" {
  description = "ARN of the Lambda function"
  value       = aws_lambda_function.lambda.arn
}

output "function_invoke_arn" {
  description = "Invoke ARN of the Lambda function"
  value       = aws_lambda_function.lambda.invoke_arn
}

output "function_qualified_arn" {
  description = "Qualified ARN of the Lambda function"
  value       = aws_lambda_function.lambda.qualified_arn
}

output "function_version" {
  description = "Version of the Lambda function"
  value       = aws_lambda_function.lambda.version
}

output "role_arn" {
  description = "ARN of the IAM role for the Lambda function"
  value       = aws_iam_role.lambda_role.arn
}

output "role_name" {
  description = "Name of the IAM role for the Lambda function"
  value       = aws_iam_role.lambda_role.name
}

output "log_group_name" {
  description = "Name of the CloudWatch log group"
  value       = aws_cloudwatch_log_group.lambda_log_group.name
}

output "log_group_arn" {
  description = "ARN of the CloudWatch log group"
  value       = aws_cloudwatch_log_group.lambda_log_group.arn
}

output "alias_arn" {
  description = "ARN of the Lambda alias (if created)"
  value       = var.publish ? aws_lambda_alias.lambda_alias[0].arn : null
}

output "source_code_hash" {
  description = "Base64 SHA256 hash of the Lambda deployment package"
  value       = aws_lambda_function.lambda.source_code_hash
}
