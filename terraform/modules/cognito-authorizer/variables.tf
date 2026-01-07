variable "api_name" {
  description = "Name of the API Gateway"
  type        = string
}

variable "rest_api_id" {
  description = "REST API ID from API Gateway"
  type        = string
}

variable "stage_name" {
  description = "API Gateway stage name"
  type        = string
}

variable "cognito_user_pool_arn" {
  description = "ARN of the Cognito User Pool"
  type        = string
}

variable "throttle_rate_limit" {
  description = "Throttle rate limit (requests per second)"
  type        = number
  default     = 5
}

variable "throttle_burst_limit" {
  description = "Throttle burst limit"
  type        = number
  default     = 10
}

variable "daily_quota_limit" {
  description = "Daily API quota per user"
  type        = number
  default     = 50000
}

variable "tags" {
  description = "Tags to apply to resources"
  type        = map(string)
  default     = {}
}
