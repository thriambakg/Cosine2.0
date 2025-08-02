# =============================================================================
# DOMAIN MODULE VARIABLES
# Variables for custom domain configuration and SSL certificate setup
# =============================================================================

variable "enable_custom_domain" {
  description = "Enable custom domain configuration with Route53 and SSL certificate"
  type        = bool
  default     = false
}

variable "domain_name" {
  description = "The domain name for the application (e.g., example.com)"
  type        = string
  default     = ""
}

variable "subdomain" {
  description = "Subdomain for the application (e.g., app, staging, prod). Leave empty for root domain"
  type        = string
  default     = ""
}

variable "alb_dns_name" {
  description = "DNS name of the Application Load Balancer"
  type        = string
}

variable "alb_zone_id" {
  description = "Zone ID of the Application Load Balancer"
  type        = string
}

variable "project_name" {
  description = "Name of the project"
  type        = string
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
}

variable "common_tags" {
  description = "Common tags to apply to all resources"
  type        = map(string)
  default     = {}
}
