# variables.tf
# Global variables for the Terraform configuration

variable "project_name" {
  description = "Name of the project"
  type        = string
  default     = "cosine"
}

variable "environment" {
  description = "Environment (staging, production, etc.)"
  type        = string
  default     = "staging"

  validation {
    condition = contains([
      "development",
      "staging",
      "production"
    ], var.environment)
    error_message = "Environment must be development, staging, or production."
  }
}

variable "aws_region" {
  description = "AWS region for resources"
  type        = string
  default     = "us-east-1"
}

variable "enable_cloudfront" {
  description = "Whether to create CloudFront distribution"
  type        = bool
  default     = true
}

variable "enable_s3_bucket" {
  description = "Whether to create S3 bucket for frontend"
  type        = bool
  default     = true
}

variable "common_tags" {
  description = "Common tags to apply to all resources"
  type        = map(string)
  default = {
    Project   = "cosine"
    Owner     = "team"
    ManagedBy = "terraform"
  }
}

# VPC Configuration
variable "vpc_cidr" {
  description = "CIDR block for VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "az_count" {
  description = "Number of Availability Zones to use"
  type        = number
  default     = 2
}

# ALB Configuration
variable "certificate_arn" {
  description = "ARN of SSL certificate for HTTPS"
  type        = string
  default     = ""
}

variable "enable_alb_access_logs" {
  description = "Enable access logs for ALB"
  type        = bool
  default     = false
}

variable "alb_access_logs_bucket" {
  description = "S3 bucket name for ALB access logs"
  type        = string
  default     = ""
}

# WAF Configuration
variable "waf_rate_limit" {
  description = "Rate limit for WAF (requests per 5 minutes)"
  type        = number
  default     = 2000
}

variable "waf_blocked_countries" {
  description = "List of country codes to block"
  type        = list(string)
  default     = []
}

# Cognito Configuration (from existing infrastructure)
variable "cognito_user_pool_id" {
  description = "Cognito User Pool ID from base infrastructure"
  type        = string
  default     = ""
}

variable "cognito_client_id" {
  description = "Cognito User Pool Client ID from base infrastructure"
  type        = string
  default     = ""
}

variable "cognito_domain" {
  description = "Cognito domain from base infrastructure"
  type        = string
  default     = ""
}

variable "api_gateway_url" {
  description = "API Gateway URL for backend services"
  type        = string
  default     = ""
}

# ECS Configuration
variable "ecs_task_cpu" {
  description = "CPU units for ECS task"
  type        = number
  default     = 256
}

variable "ecs_task_memory" {
  description = "Memory for ECS task in MB"
  type        = number
  default     = 512
}

variable "ecs_task_memory_reservation" {
  description = "Memory reservation for ECS task in MB"
  type        = number
  default     = 256
}

variable "ecs_desired_count" {
  description = "Desired number of ECS tasks"
  type        = number
  default     = 2
}

variable "enable_service_discovery" {
  description = "Enable service discovery for ECS"
  type        = bool
  default     = false
}

variable "enable_ecs_execute_command" {
  description = "Enable execute command for ECS debugging"
  type        = bool
  default     = false
}