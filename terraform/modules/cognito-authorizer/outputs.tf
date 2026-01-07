output "cognito_authorizer_id" {
  description = "ID of the Cognito authorizer"
  value       = aws_api_gateway_authorizer.cognito.id
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
