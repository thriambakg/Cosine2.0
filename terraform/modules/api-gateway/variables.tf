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
    path_part           = string
    parent_resource_key = optional(string)
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
    timeout_milliseconds    = optional(number, 29000)  # Default 29 seconds, max for API Gateway
    authorization_type      = optional(string, "NONE") # "NONE" or "COGNITO_USER_POOLS"
    authorization_scopes    = optional(list(string), [])
  }))
  default = {}
}

# Lambda permissions configuration
variable "lambda_permissions" {
  description = "Map of Lambda permissions to create for API Gateway integration"
  type = map(object({
    function_arn  = string
    http_method   = string
    resource_path = string
  }))
  default = {}
}

# Deployment trigger variable
variable "deployment_trigger" {
  description = "Trigger for API Gateway deployment (change this to force redeployment)"
  type        = string
  default     = "1"
}

# Cognito User Pool authorizer (REST API)
variable "cognito_user_pool_arn" {
  description = "ARN of the Cognito User Pool for authorizer"
  type        = string
}

# Rate limiting configuration
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

# Force Cognito authorization for all methods
variable "force_cognito_authorization" {
  description = "When true, all methods use Cognito authorizer regardless of per-method config"
  type        = bool
  default     = true
}

# -----------------------------------------------------------------------------
# Optional: Chat agent least-privilege S3 read (GetObject only per bucket type)
# When set, the module creates one IAM policy per bucket and attaches to the role.
# -----------------------------------------------------------------------------
variable "chat_agent_role_name" {
  description = "Optional. IAM role name of the chat agent Lambda. If set with chat_agent_s3_read_bucket_arns, creates one GetObject-only policy per bucket and attaches to this role."
  type        = string
  default     = null
}

variable "chat_agent_s3_read_bucket_arns" {
  description = "Optional. Map of S3 bucket ARNs for chat agent read-only access. Keys: sec_filings, congress_bills, lda_disclosures, politician_trades, chat_files, stock_historical, usaspending_data. Each gets a separate GetObject-only policy."
  type        = map(string)
  default     = {}
}

variable "project_name" {
  description = "Project name used for IAM policy names (e.g. cosine). Required when chat_agent_role_name is set."
  type        = string
  default     = "cosine"
}

variable "environment" {
  description = "Environment used for IAM policy names (e.g. production). Required when chat_agent_role_name is set."
  type        = string
  default     = "production"
}

variable "common_tags" {
  description = "Tags to apply to IAM policies (when chat agent S3 policies are created)"
  type        = map(string)
  default     = {}
}

