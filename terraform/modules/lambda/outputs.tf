# Lambda Module Outputs
# modules/lambda/outputs.tf
# Comprehensive outputs for Lambda function integration

# Basic Function Information
output "function_name" {
  description = "Name of the Lambda function"
  value       = aws_lambda_function.function.function_name
}

output "function_arn" {
  description = "ARN of the Lambda function"
  value       = aws_lambda_function.function.arn
}

output "function_qualified_arn" {
  description = "Qualified ARN of the Lambda function"
  value       = aws_lambda_function.function.qualified_arn
}

output "invoke_arn" {
  description = "ARN to invoke the Lambda function"
  value       = aws_lambda_function.function.invoke_arn
}

output "function_url" {
  description = "Lambda function URL (if function URLs are enabled)"
  value       = try(aws_lambda_function.function.function_url, null)
}

# Runtime Information
output "runtime" {
  description = "Runtime of the Lambda function"
  value       = aws_lambda_function.function.runtime
}

output "handler" {
  description = "Handler of the Lambda function"
  value       = aws_lambda_function.function.handler
}

output "timeout" {
  description = "Timeout of the Lambda function"
  value       = aws_lambda_function.function.timeout
}

output "memory_size" {
  description = "Memory size of the Lambda function"
  value       = aws_lambda_function.function.memory_size
}

output "architectures" {
  description = "Instruction set architecture of the Lambda function"
  value       = aws_lambda_function.function.architectures
}

# Security Information
output "execution_role_arn" {
  description = "ARN of the Lambda execution role"
  value       = aws_iam_role.lambda_execution_role.arn
}

output "execution_role_name" {
  description = "Name of the Lambda execution role"
  value       = aws_iam_role.lambda_execution_role.name
}

output "kms_key_arn" {
  description = "KMS key ARN used for encryption"
  value       = var.kms_key_id
}

# Layer Information
output "layer_arns" {
  description = "ARNs of the created Lambda layers"
  value       = { for k, v in aws_lambda_layer_version.dependencies : k => v.arn }
}

output "layer_versions" {
  description = "Version numbers of the created Lambda layers"
  value       = { for k, v in aws_lambda_layer_version.dependencies : k => v.version }
}

output "all_layer_arns" {
  description = "All layer ARNs attached to the function (created + external)"
  value       = aws_lambda_function.function.layers
}

# Monitoring Information
output "log_group_name" {
  description = "Name of the CloudWatch log group"
  value       = aws_cloudwatch_log_group.lambda_logs.name
}

output "log_group_arn" {
  description = "ARN of the CloudWatch log group"
  value       = aws_cloudwatch_log_group.lambda_logs.arn
}

output "error_alarm_arn" {
  description = "ARN of the error CloudWatch alarm"
  value       = try(aws_cloudwatch_metric_alarm.lambda_errors[0].arn, null)
}

output "duration_alarm_arn" {
  description = "ARN of the duration CloudWatch alarm"
  value       = try(aws_cloudwatch_metric_alarm.lambda_duration[0].arn, null)
}

# Network Information
output "vpc_config" {
  description = "VPC configuration of the Lambda function"
  value       = try(aws_lambda_function.function.vpc_config, null)
  sensitive   = true
}

# Integration Information
output "api_gateway_permission" {
  description = "API Gateway permission for Lambda invocation"
  value       = try(aws_lambda_permission.api_gateway[0].statement_id, null)
}

output "eventbridge_permissions" {
  description = "EventBridge permissions for Lambda invocation"
  value       = { for k, v in aws_lambda_permission.eventbridge : k => v.statement_id }
}

output "s3_permissions" {
  description = "S3 permissions for Lambda invocation"
  value       = { for k, v in aws_lambda_permission.s3 : k => v.statement_id }
}

# Enterprise Features
output "autoscaling_target_arn" {
  description = "ARN of the autoscaling target for provisioned concurrency"
  value       = try(aws_appautoscaling_target.lambda_target[0].arn, null)
}

output "autoscaling_policy_arn" {
  description = "ARN of the autoscaling policy for provisioned concurrency"
  value       = try(aws_appautoscaling_policy.lambda_policy[0].arn, null)
}

# Configuration Information
output "last_modified" {
  description = "Last modified timestamp of the Lambda function"
  value       = aws_lambda_function.function.last_modified
}

output "source_code_size" {
  description = "Size of the Lambda function source code"
  value       = aws_lambda_function.function.source_code_size
}

output "source_code_hash" {
  description = "SHA256 hash of the Lambda function source code"
  value       = aws_lambda_function.function.source_code_hash
}

output "version" {
  description = "Version of the Lambda function"
  value       = aws_lambda_function.function.version
}

# Environment Information
output "environment_variables" {
  description = "Environment variables of the Lambda function"
  value       = try(aws_lambda_function.function.environment[0].variables, {})
  sensitive   = true
}

# Dead Letter Queue
output "dead_letter_queue_arn" {
  description = "ARN of the dead letter queue"
  value       = var.dead_letter_queue_arn
}

# File System
output "file_system_config" {
  description = "EFS file system configuration"
  value       = try(aws_lambda_function.function.file_system_config, null)
}

# Comprehensive function configuration for reference
output "function_config" {
  description = "Complete Lambda function configuration"
  value = {
    function_name  = aws_lambda_function.function.function_name
    function_arn   = aws_lambda_function.function.arn
    invoke_arn     = aws_lambda_function.function.invoke_arn
    runtime        = aws_lambda_function.function.runtime
    handler        = aws_lambda_function.function.handler
    timeout        = aws_lambda_function.function.timeout
    memory_size    = aws_lambda_function.function.memory_size
    architectures  = aws_lambda_function.function.architectures
    execution_role = aws_iam_role.lambda_execution_role.arn
    log_group      = aws_cloudwatch_log_group.lambda_logs.name
    layers         = aws_lambda_function.function.layers
    version        = aws_lambda_function.function.version
    last_modified  = aws_lambda_function.function.last_modified
  }
}
