# Lambda Module Variables
# modules/lambda/variables.tf
# Comprehensive variable definitions for security-compliant Lambda functions

# Basic Configuration
variable "project_name" {
  description = "Name of the project"
  type        = string

  validation {
    condition     = length(var.project_name) > 0 && length(var.project_name) <= 64
    error_message = "Project name must be between 1 and 64 characters."
  }
}

variable "function_name" {
  description = "Name of the Lambda function (will be prefixed with project_name)"
  type        = string

  validation {
    condition     = length(var.function_name) > 0 && length(var.function_name) <= 64
    error_message = "Function name must be between 1 and 64 characters."
  }
}

variable "environment" {
  description = "Environment name (e.g., dev, staging, prod)"
  type        = string

  validation {
    condition = contains([
      "development",
      "staging",
      "production"
    ], var.environment)
    error_message = "Environment must be development, staging, or production."
  }
}

variable "description" {
  description = "Description of the Lambda function"
  type        = string
  default     = "Lambda function for Cosine AI Agent"
}

variable "purpose" {
  description = "Purpose of the Lambda function for tagging"
  type        = string
  default     = "AIAgent"
}

# Runtime Configuration
variable "runtime" {
  description = "Lambda runtime environment"
  type        = string
  default     = "python3.11"

  validation {
    condition = contains([
      "python3.9", "python3.10", "python3.11", "python3.12",
      "nodejs18.x", "nodejs20.x",
      "java17", "java21",
      "dotnet6", "dotnet8"
    ], var.runtime)
    error_message = "Runtime must be a supported AWS Lambda runtime."
  }
}

variable "handler" {
  description = "Lambda function handler"
  type        = string
  default     = "lambda_handler.lambda_handler"
}

variable "timeout" {
  description = "Lambda function timeout in seconds"
  type        = number
  default     = 30

  validation {
    condition     = var.timeout >= 1 && var.timeout <= 900
    error_message = "Timeout must be between 1 and 900 seconds."
  }
}

variable "memory_size" {
  description = "Lambda function memory size in MB"
  type        = number
  default     = 512

  validation {
    condition     = var.memory_size >= 128 && var.memory_size <= 10240
    error_message = "Memory size must be between 128 and 10240 MB."
  }
}

variable "architectures" {
  description = "Instruction set architecture for Lambda function"
  type        = list(string)
  default     = ["x86_64"]

  validation {
    condition = alltrue([
      for arch in var.architectures : contains(["x86_64", "arm64"], arch)
    ])
    error_message = "Architectures must be x86_64 or arm64."
  }
}

variable "reserved_concurrency" {
  description = "Reserved concurrency for the Lambda function"
  type        = number
  default     = null

  validation {
    condition     = var.reserved_concurrency == null || var.reserved_concurrency >= 0
    error_message = "Reserved concurrency must be non-negative or null."
  }
}

# Source Code Configuration
variable "deployment_package" {
  description = "Lambda deployment package configuration"
  type = object({
    filename         = string
    source_code_hash = string
  })

  validation {
    condition     = can(regex("\\.(zip|jar)$", var.deployment_package.filename))
    error_message = "Deployment package must be a .zip or .jar file."
  }
}

# Layer Configuration
variable "lambda_layers" {
  description = "Map of Lambda layers to create and attach"
  type = map(object({
    filename            = string
    description         = string
    compatible_runtimes = list(string)
    source_code_hash    = string
    purpose             = string
  }))
  default = {}
}

variable "external_layer_arns" {
  description = "List of external Lambda layer ARNs to attach"
  type        = list(string)
  default     = []
}

# Environment Variables
variable "environment_variables" {
  description = "Environment variables for the Lambda function"
  type        = map(string)
  default     = {}
  sensitive   = true
}

# Security Configuration
variable "kms_key_id" {
  description = "KMS key ID for encryption (required for compliance)"
  type        = string

  validation {
    condition     = var.kms_key_id != null && var.kms_key_id != ""
    error_message = "KMS key ID is required for security compliance."
  }
}

variable "vpc_config" {
  description = "VPC configuration for Lambda function"
  type = object({
    subnet_ids         = list(string)
    security_group_ids = list(string)
  })
  default = null
}

variable "tracing_mode" {
  description = "X-Ray tracing mode"
  type        = string
  default     = "Active"

  validation {
    condition     = contains(["PassThrough", "Active"], var.tracing_mode)
    error_message = "Tracing mode must be PassThrough or Active."
  }
}

# Custom IAM Policies
variable "custom_policies" {
  description = "List of custom IAM policy statements"
  type = list(object({
    Effect    = string
    Action    = list(string)
    Resource  = list(string)
    Condition = optional(map(map(string)), {})
  }))
  default = []
}

# Error Handling
variable "dead_letter_queue_arn" {
  description = "ARN of the dead letter queue for failed executions"
  type        = string
  default     = null
}

# File System (EFS) Configuration
variable "file_system_config" {
  description = "EFS file system configuration for large dependencies"
  type = object({
    arn              = string
    local_mount_path = string
  })
  default = null
}

# Monitoring Configuration
variable "enable_monitoring" {
  description = "Enable CloudWatch alarms for the Lambda function"
  type        = bool
  default     = true
}

variable "log_retention_days" {
  description = "CloudWatch log retention period in days"
  type        = number
  default     = 14

  validation {
    condition     = contains([1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1827, 3653], var.log_retention_days)
    error_message = "Log retention days must be a valid CloudWatch retention period."
  }
}

variable "error_threshold" {
  description = "Error count threshold for CloudWatch alarm"
  type        = number
  default     = 5
}

variable "duration_threshold" {
  description = "Duration threshold in milliseconds for CloudWatch alarm"
  type        = number
  default     = 10000
}

variable "alarm_sns_topic_arns" {
  description = "List of SNS topic ARNs for alarm notifications"
  type        = list(string)
  default     = []
}

# Integration Configuration
variable "api_gateway_integration" {
  description = "API Gateway integration configuration"
  type = object({
    execution_arn = string
  })
  default = null
}

variable "eventbridge_rules" {
  description = "Map of EventBridge rules to attach"
  type = map(object({
    rule_arn = string
  }))
  default = {}
}

variable "s3_bucket_notifications" {
  description = "Map of S3 bucket notifications to attach"
  type = map(object({
    bucket_arn = string
  }))
  default = {}
}

# Enterprise Features
variable "provisioned_concurrency" {
  description = "Provisioned concurrency configuration for enterprise workloads"
  type = object({
    min_capacity       = number
    max_capacity       = number
    target_utilization = number
  })
  default = null

  validation {
    condition = var.provisioned_concurrency == null || (
      var.provisioned_concurrency.min_capacity >= 1 &&
      var.provisioned_concurrency.max_capacity >= var.provisioned_concurrency.min_capacity &&
      var.provisioned_concurrency.target_utilization >= 10 &&
      var.provisioned_concurrency.target_utilization <= 90
    )
    error_message = "Provisioned concurrency must have valid min/max capacity and target utilization between 10-90%."
  }
}

# Common Tags
variable "tags" {
  description = "Common tags to apply to all resources"
  type        = map(string)
  default = {
    Project   = "cosine"
    ManagedBy = "terraform"
  }
}
