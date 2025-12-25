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

# VPC Configuration - DISABLED FOR CLOUDFRONT DEPLOYMENT
# CloudFront + S3 static hosting doesn't need VPC networking
# variable "vpc_cidr" {
#   description = "CIDR block for VPC"
#   type        = string
#   default     = "10.0.0.0/16"
# }

# variable "az_count" {
#   description = "Number of Availability Zones to use"
#   type        = number
#   default     = 2
# }

# SSL Certificate Configuration
variable "certificate_arn" {
  description = "ARN of SSL certificate for HTTPS"
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

# Cognito and DynamoDB Configuration - Not needed for minimal stock volatility setup
# These variables are kept for future expansion when authentication and database features are added

# =============================================================================
# CUSTOM DOMAIN CONFIGURATION
# Variables for custom domain setup with Route53 and SSL certificates
# =============================================================================

variable "enable_custom_domain" {
  description = "Enable custom domain configuration with Route53 and SSL certificate"
  type        = bool
  default     = false
}

variable "domain_name" {
  description = "The domain name for the application (e.g., mycompany.com)"
  type        = string
  default     = ""
}

variable "staging_subdomain" {
  description = "Subdomain for staging environment (e.g., staging)"
  type        = string
  default     = "staging"
}

variable "production_subdomain" {
  description = "Subdomain for production environment (e.g., app or leave empty for root domain)"
  type        = string
  default     = ""
}

# ============================================================================
# DEPLOYMENT CONFIGURATION VARIABLES
# ============================================================================

variable "use_cloudfront_deployment" {
  description = "Whether to use CloudFront + S3 static hosting instead of ECS"
  type        = bool
  default     = true
}

variable "cloudfront_aliases" {
  description = "Custom domain aliases for CloudFront distribution"
  type        = list(string)
  default     = []
}

# ============================================================================
# SES CONFIGURATION VARIABLES
# ============================================================================

variable "ses_from_email" {
  description = "Verified email address to send alerts from via SES"
  type        = string
  default     = "noreply@cosine-ai.com"
}

# ============================================================================
# CHAT AGENT CONTAINER CONFIGURATION
# ============================================================================

variable "chat_agent_image_uri" {
  description = "Full ECR image URI for the chat agent container (including tag). If empty, uses repository URL with chat_agent_image_tag."
  type        = string
  default     = ""
}

variable "chat_agent_image_tag" {
  description = "Image tag for the chat agent container. Defaults to 'latest' for development, should be versioned for production."
  type        = string
  default     = "latest"
}

variable "chat_agent_deployment_trigger" {
  description = "Trigger to force Lambda function redeployment when image changes"
  type        = string
  default     = ""
}

variable "encryption_secret" {
  description = "Secret key for encrypting/decrypting context items. If not provided, a random secret will be generated."
  type        = string
  default     = ""
  sensitive   = true
}