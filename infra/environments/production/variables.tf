# Variables for Production Environment

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "lambda_runtime" {
  description = "Lambda runtime version"
  type        = string
  default     = "python3.10"
}

variable "lambda_timeout" {
  description = "Lambda function timeout in seconds"
  type        = number
  default     = 90  # Slightly higher for production
}

variable "robinhood_lambda_timeout" {
  description = "Robinhood Lambda function timeout in seconds"
  type        = number
  default     = 300
}

variable "log_level" {
  description = "Log level for Lambda functions"
  type        = string
  default     = "WARNING"  # Less verbose logging in production
}
