# Outputs for OPTIONS Integration Module

output "options_methods" {
  description = "Map of created OPTIONS methods"
  value       = aws_api_gateway_method.options_methods
}

output "options_integrations" {
  description = "Map of created OPTIONS integrations"
  value       = aws_api_gateway_integration.options_integrations
}

output "options_method_responses" {
  description = "Map of created OPTIONS method responses"
  value       = aws_api_gateway_method_response.options_method_responses
}

output "options_integration_responses" {
  description = "Map of created OPTIONS integration responses"
  value       = aws_api_gateway_integration_response.options_integration_responses
}
