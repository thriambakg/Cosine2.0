output "user_usage_table_name" {
  description = "Name of the user usage tracking table"
  value       = aws_dynamodb_table.user_usage.name
}

output "user_usage_table_arn" {
  description = "ARN of the user usage tracking table"
  value       = aws_dynamodb_table.user_usage.arn
}

output "user_credits_table_name" {
  description = "Name of the user credits table"
  value       = aws_dynamodb_table.user_credits.name
}

output "user_credits_table_arn" {
  description = "ARN of the user credits table"
  value       = aws_dynamodb_table.user_credits.arn
}

output "billing_transactions_table_name" {
  description = "Name of the billing transactions table"
  value       = aws_dynamodb_table.billing_transactions.name
}

output "billing_transactions_table_arn" {
  description = "ARN of the billing transactions table"
  value       = aws_dynamodb_table.billing_transactions.arn
}
