# ECS Module Variables
# modules/ecs/variables.tf

variable "project_name" {
  description = "Name of the project"
  type        = string
}

variable "environment" {
  description = "Environment (development, staging, production)"
  type        = string
}

variable "tags" {
  description = "Common tags to apply to all resources"
  type        = map(string)
  default     = {}
}

variable "kms_key_arn" {
  description = "ARN of the KMS key for encryption"
  type        = string
}

variable "aws_region" {
  description = "AWS region"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID where ECS service will be deployed"
  type        = string
}

variable "private_subnet_ids" {
  description = "List of private subnet IDs for ECS tasks"
  type        = list(string)
}

variable "alb_security_group_id" {
  description = "Security group ID of the ALB"
  type        = string
}

variable "target_group_arn" {
  description = "ARN of the target group for the load balancer"
  type        = string
}

variable "ecr_repository_url" {
  description = "URL of the ECR repository"
  type        = string
}

variable "cognito_user_pool_id" {
  description = "Cognito User Pool ID"
  type        = string
}

variable "cognito_client_id" {
  description = "Cognito User Pool Client ID"
  type        = string
}

variable "cognito_domain" {
  description = "Cognito domain"
  type        = string
}

variable "api_gateway_url" {
  description = "API Gateway URL"
  type        = string
}

variable "task_cpu" {
  description = "CPU units for the task"
  type        = number
  default     = 256
}

variable "task_memory" {
  description = "Memory for the task in MB"
  type        = number
  default     = 512
}

variable "task_memory_reservation" {
  description = "Memory reservation for the task in MB"
  type        = number
  default     = 256
}

variable "desired_count" {
  description = "Desired number of tasks"
  type        = number
  default     = 2
}

variable "enable_service_discovery" {
  description = "Enable service discovery"
  type        = bool
  default     = false
}

variable "enable_execute_command" {
  description = "Enable execute command for debugging"
  type        = bool
  default     = false
}
