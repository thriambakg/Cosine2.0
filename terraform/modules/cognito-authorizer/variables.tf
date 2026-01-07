variable "api_name" {
  description = "Name of the API Gateway"
  type        = string
}

variable "rest_api_id" {
  description = "REST API ID from API Gateway"
  type        = string
}

variable "cognito_user_pool_arn" {
  description = "ARN of the Cognito User Pool"
  type        = string
}

variable "tags" {
  description = "Tags to apply to resources"
  type        = map(string)
  default     = {}
}
