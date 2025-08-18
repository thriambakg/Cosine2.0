# API Gateway Module Variables
# modules/api-gateway/variables.tf

variable "api_name" {
  description = "Name of the API Gateway"
  type        = string
}

variable "api_description" {
  description = "Description of the API Gateway"
  type        = string
  default     = "API Gateway for Lambda functions"
}

variable "stage_name" {
  description = "Name of the API Gateway stage"
  type        = string
  default     = "production"
}

variable "tags" {
  description = "Tags to apply to resources"
  type        = map(string)
  default     = {}
}

# Resources configuration
variable "resources" {
  description = "Map of API Gateway resources to create"
  type = map(object({
    path_part = string
  }))
  default = {}
}

# Methods configuration
variable "methods" {
  description = "Map of API Gateway methods to create"
  type = map(object({
    resource_key            = string
    http_method             = string
    integration_type        = string # "AWS_PROXY" or "MOCK"
    integration_http_method = string
    lambda_arn              = optional(string)
    request_parameters      = optional(map(bool), {})
  }))
  default = {}
}
