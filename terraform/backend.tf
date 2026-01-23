# backend.tf - Remote state configuration
# This file configures Terraform to store state remotely in S3
# This ensures state persistence across CI/CD runs and enables team collaboration

terraform {
  backend "s3" {
    # Backend configuration will be provided via backend config files
    # See: backend-configs/ directory for environment-specific configurations
    # 
    # Usage:
    # terraform init -backend-config="backend-configs/production.tfbackend"
    # terraform init -backend-config="backend-configs/staging.tfbackend"
    # terraform init -backend-config="backend-configs/development.tfbackend"
  }
}


