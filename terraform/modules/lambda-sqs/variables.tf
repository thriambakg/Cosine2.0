# Lambda-SQS Module Variables
# modules/lambda-sqs/variables.tf
# All variables from base lambda module plus SQS-specific variables

# ============================================================================
# BASE LAMBDA VARIABLES (same as base lambda module)
# ============================================================================

variable "function_name" {
  description = "Name of the Lambda function"
  type        = string
}

variable "description" {
  description = "Description of the Lambda function"
  type        = string
  default     = "Lambda function created by Terraform"
}

variable "handler" {
  description = "Lambda function handler"
  type        = string
  default     = "lambda_function.lambda_handler"
}

variable "runtime" {
  description = "Lambda function runtime"
  type        = string
  default     = "python3.11"
}

variable "timeout" {
  description = "Lambda function timeout in seconds"
  type        = number
  default     = 30
}

variable "memory_size" {
  description = "Amount of memory in MB your Lambda function can use at runtime"
  type        = number
  default     = 128
}

variable "source_dir" {
  description = "Source directory containing Lambda function code"
  type        = string
}

variable "environment_variables" {
  description = "Environment variables for the Lambda function"
  type        = map(string)
  default     = {}
}

variable "additional_policy_arns" {
  description = "List of additional IAM policy ARNs to attach to the Lambda execution role"
  type        = list(string)
  default     = []
}

variable "tags" {
  description = "A map of tags to assign to the resource"
  type        = map(string)
  default     = {}
}

variable "layers" {
  description = "List of Lambda layer ARNs to attach to the function"
  type        = list(string)
  default     = []
}

variable "reserved_concurrent_executions" {
  description = "Reserved concurrency for Lambda (null = unlimited, 0 = disable, >0 = limit). Useful for rate control with SQS."
  type        = number
  default     = null
}

# ============================================================================
# SQS-SPECIFIC VARIABLES
# ============================================================================

variable "sqs_queue_name" {
  description = "Name for the SQS queue (defaults to '{function_name}-queue' if not provided)"
  type        = string
  default     = null
}

variable "sqs_visibility_timeout_seconds" {
  description = "SQS visibility timeout in seconds (must be >= Lambda timeout). Defaults to Lambda timeout + 60 seconds."
  type        = number
  default     = null
}

variable "sqs_message_retention_seconds" {
  description = "Number of seconds Amazon SQS retains a message in the queue"
  type        = number
  default     = null # Defaults to 1209600 (14 days) in main.tf
}

variable "sqs_delay_seconds" {
  description = "Time in seconds that the delivery of all messages in the queue will be delayed"
  type        = number
  default     = null # Defaults to 0 in main.tf
}

variable "sqs_max_message_size" {
  description = "Maximum message size in bytes (default: 262144 = 256 KB)"
  type        = number
  default     = null
}

variable "sqs_receive_wait_time_seconds" {
  description = "Time for which a ReceiveMessage call will wait for a message to arrive (long polling). 0 = short polling, >0 = long polling (max 20)"
  type        = number
  default     = null # Defaults to 0 (short polling) in main.tf
}

variable "sqs_batch_size" {
  description = "Number of messages to process per Lambda invocation (1-10 for standard queues, 1-10 for FIFO)"
  type        = number
  default     = null # Defaults to 1 in main.tf
}

variable "sqs_max_batching_window_seconds" {
  description = "Maximum batching window in seconds for SQS (0-300). Lambda will wait up to this time to batch messages."
  type        = number
  default     = null # Defaults to 0 (no batching window) in main.tf
}

variable "sqs_function_response_types" {
  description = "List of function response types to apply. Valid values: ReportBatchItemFailures"
  type        = list(string)
  default     = [] # Empty by default, can be set to ["ReportBatchItemFailures"] for partial batch failure handling
}

variable "sqs_enable_dlq" {
  description = "Whether to create a dead letter queue for failed messages"
  type        = bool
  default     = true
}

variable "sqs_max_receive_count" {
  description = "Maximum number of times a message is delivered before moving to DLQ"
  type        = number
  default     = null # Defaults to 3 in main.tf
}

variable "sqs_dlq_message_retention_seconds" {
  description = "Number of seconds Amazon SQS retains a message in the dead letter queue"
  type        = number
  default     = null # Defaults to same as main queue retention in main.tf
}

variable "sqs_dlq_visibility_timeout_seconds" {
  description = "Visibility timeout for the dead letter queue"
  type        = number
  default     = null # Defaults to 30 in main.tf
}

variable "sqs_fifo_queue" {
  description = "Whether to create a FIFO queue (requires queue name to end with .fifo)"
  type        = bool
  default     = false
}

variable "sqs_content_based_deduplication" {
  description = "Enables content-based deduplication for FIFO queues"
  type        = bool
  default     = false
}

variable "kms_key_id" {
  description = "KMS key ID for SQS encryption (optional)"
  type        = string
  default     = null
}

variable "kms_data_key_reuse_period_seconds" {
  description = "Length of time in seconds for which SQS can reuse a data key before calling KMS again"
  type        = number
  default     = null # Defaults to 300 in main.tf
}

# ============================================================================
# WRAPPER LAMBDA VARIABLES (for synchronous API Gateway responses)
# ============================================================================

variable "enable_wrapper_lambda" {
  description = "Whether to create a wrapper Lambda that handles synchronous API Gateway requests via SQS"
  type        = bool
  default     = false
}

variable "wrapper_timeout" {
  description = "Timeout for the wrapper Lambda in seconds (how long to wait for worker completion)"
  type        = number
  default     = 300 # 5 minutes default
}

variable "sns_topic_name" {
  description = "Name for the SNS topic for completion notifications (defaults to '{function_name}-completion' if not provided)"
  type        = string
  default     = null
}

variable "response_table_name" {
  description = "DynamoDB table name for storing request/response correlation (optional, uses SNS message attributes if not provided)"
  type        = string
  default     = null
}

variable "wrapper_layers" {
  description = "List of Lambda layer ARNs to attach to the wrapper Lambda function"
  type        = list(string)
  default     = []
}

variable "completion_sns_env_var_name" {
  description = "Environment variable name for completion SNS topic ARN in worker Lambda (defaults to '{FUNCTION_NAME}_COMPLETION_SNS_TOPIC_ARN')"
  type        = string
  default     = null
}