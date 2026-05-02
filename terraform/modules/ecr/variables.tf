# ECR Module Variables
# modules/ecr/variables.tf

variable "project_name" {
  description = "Name of the project"
  type        = string
}

variable "environment" {
  description = "Environment (development, staging, production)"
  type        = string
}

variable "kms_key_arn" {
  description = "ARN of the KMS key for encryption"
  type        = string
}

variable "tags" {
  description = "Common tags to apply to all resources"
  type        = map(string)
  default     = {}
}

variable "repository_name" {
  description = "Name of the ECR repository (defaults to 'frontend')"
  type        = string
  default     = "frontend"
}

# IAM principals allowed to pull images (same account). Avoids relying on duplicate/overwritten repo policies.
variable "image_pull_principal_arns" {
  description = "IAM role/user ARNs that may pull from this repository (e.g. Lambda execution role for chat agent)"
  type        = list(string)
  default     = []
}