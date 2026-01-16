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

output "internal_api_key" {
  description = "Internal API key for machine-to-machine communication"
  value       = aws_api_gateway_api_key.internal.value
  sensitive   = true
}

output "internal_api_key_id" {
  description = "Internal API key ID"
  value       = aws_api_gateway_api_key.internal.id
}

output "cognito_authorizer_id" {
  description = "ID of the Cognito authorizer"
  value       = aws_api_gateway_authorizer.cognito.id
}

output "resource_ids" {
  description = "Map of resource keys to their API Gateway resource IDs"
  value       = { for k, v in aws_api_gateway_resource.this : k => v.id }
}

output "authorizer_id" {
  description = "ID of the Cognito authorizer (alias for cognito_authorizer_id)"
  value       = aws_api_gateway_authorizer.cognito.id
}

output "execution_arn" {
  description = "Execution ARN of the REST API (alias for rest_api_execution_arn)"
  value       = aws_api_gateway_rest_api.this.execution_arn
}