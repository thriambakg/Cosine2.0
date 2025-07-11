# Root main.tf - This file is deprecated
# Please use the environment-specific configurations in:
# - infra/environments/staging/
# - infra/environments/production/
#
# This file is kept for backward compatibility but should not be used directly.

# NOTE: Infrastructure is now managed through environment-specific folders.
# To deploy:
# 1. For staging: cd infra/environments/staging && terraform init && terraform plan
# 2. For production: cd infra/environments/production && terraform init && terraform plan
# 3. Use GitHub Actions workflow for automated deployments

terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# This configuration is deprecated - use environment-specific folders instead
locals {
  deprecation_warning = "WARNING: This root configuration is deprecated. Use infra/environments/{staging,production}/ instead."
}