# modules/lambda/variables.tf
# Input variables for the Lambda module

variable "function_name" {
  description = "Name of the Lambda function"
  type        = string
}

variable "description" {
  description = "Description of the Lambda function"
  type        = string
  default     = ""
}

variable "runtime" {
  description = "Runtime for the Lambda function"
  type        = string
  default     = "python3.11"
}

variable "handler" {
  description = "Handler for the Lambda function"
  type        = string
  default     = "lambda_function.lambda_handler"
}

variable "source_dir" {
  description = "Directory containing the Lambda function source code"
  type        = string
}

variable "environment_variables" {
  description = "Environment variables for the Lambda function"
  type        = map(string)
  default     = {}
}

variable "timeout" {
  description = "Timeout for the Lambda function in seconds"
  type        = number
  default     = 30
}

variable "memory_size" {
  description = "Memory size for the Lambda function in MB"
  type        = number
  default     = 128
}

variable "vpc_config" {
  description = "VPC configuration for the Lambda function"
  type = object({
    subnet_ids         = list(string)
    security_group_ids = list(string)
  })
  default = null
}

variable "layers" {
  description = "List of Lambda layer ARNs"
  type        = list(string)
  default     = []
}

variable "reserved_concurrent_executions" {
  description = "Reserved concurrent executions for the Lambda function"
  type        = number
  default     = -1
}

variable "dead_letter_queue_target_arn" {
  description = "ARN of the dead letter queue"
  type        = string
  default     = null
}

variable "tags" {
  description = "Tags to apply to the Lambda function"
  type        = map(string)
  default     = {}
}

variable "publish" {
  description = "Whether to publish the Lambda function"
  type        = bool
  default     = false
}

variable "kms_key_arn" {
  description = "ARN of the KMS key for environment variable encryption"
  type        = string
  default     = null
}

variable "additional_iam_policies" {
  description = "Additional IAM policies to attach to the Lambda execution role"
  type        = list(string)
  default     = []
}

variable "create_api_gateway_permission" {
  description = "Whether to create API Gateway permission for this Lambda"
  type        = bool
  default     = false
}

variable "api_gateway_rest_api_id" {
  description = "API Gateway REST API ID for permissions"
  type        = string
  default     = null
}

variable "project_name" {
  description = "Name of the project for naming resources"
  type        = string
}

variable "environment" {
  description = "Environment (staging, production, etc.)"
  type        = string
}
