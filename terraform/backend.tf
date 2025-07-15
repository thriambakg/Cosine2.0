# backend.tf - Remote state configuration
# This file configures Terraform to store state remotely in S3
# This ensures state persistence across CI/CD runs and enables team collaboration

terraform {
  backend "s3" {
    # S3 bucket for storing Terraform state
    bucket = "cosine-terraform-state-bucket"
    
    # AWS region where the bucket is located
    region = "us-east-1"
    
    # DynamoDB table for state locking (prevents concurrent modifications)
    dynamodb_table = "cosine-terraform-locks"
    
    # Enable versioning and encryption
    encrypt = true
    
    # Note: The 'key' parameter will be provided during terraform init
    # This allows for environment-specific state files
  }
}
