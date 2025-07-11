# Variables for Cosine App Module

variable "environment" {
  description = "Environment name (staging, production)"
  type        = string
  
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "Environment must be either 'staging' or 'production'."
  }
}

variable "project_name" {
  description = "Project name for resource naming"
  type        = string
  default     = "cosine"
}

variable "lambda_runtime" {
  description = "Lambda runtime version"
  type        = string
  default     = "python3.10"
}

variable "lambda_timeout" {
  description = "Lambda function timeout in seconds"
  type        = number
  default     = 60
}

variable "robinhood_lambda_timeout" {
  description = "Robinhood Lambda function timeout in seconds"
  type        = number
  default     = 300
}

variable "log_level" {
  description = "Log level for Lambda functions"
  type        = string
  default     = "INFO"
  
  validation {
    condition     = contains(["DEBUG", "INFO", "WARNING", "ERROR"], var.log_level)
    error_message = "Log level must be one of: DEBUG, INFO, WARNING, ERROR."
  }
}

variable "common_tags" {
  description = "Common tags to apply to all resources"
  type        = map(string)
  default     = {}
}
