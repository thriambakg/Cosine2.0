# Multi-Repository Deployment Guide

This guide explains how to deploy the complete Cosine infrastructure across both repositories.

## 📋 Repository Overview

### 1. **Cosine-Base-Infra** (Foundation)
- **Purpose**: Shared infrastructure and state management
- **Contains**: S3 state bucket, Cognito, DynamoDB tables, KMS keys, CloudWatch
- **Deploy**: Once per environment (development/staging/production)

### 2. **Cosine2.0** (Application)
- **Purpose**: Application-specific infrastructure  
- **Contains**: Lambda functions, API Gateway, application-specific resources
- **Deploy**: Per application deployment
- **Depends on**: Cosine-Base-Infra

## 🚀 Deployment Order

### Phase 1: Base Infrastructure (One-time setup)

1. **Deploy Bootstrap** (Manual, Admin only):
   ```bash
   cd Cosine-Base-Infra/terraform/bootstrap
   terraform init
   terraform apply
   ```

2. **Deploy Base Infrastructure**:
   ```bash
   cd Cosine-Base-Infra/terraform
   terraform init -backend-config="backend-configs/staging.tfbackend"
   terraform plan -var-file="environments/staging.auto.tfvars"
   terraform apply
   ```

### Phase 2: Application Infrastructure

3. **Deploy Application**:
   ```bash
   cd Cosine2.0/terraform
   terraform init -backend-config="backend-configs/staging.tfbackend"
   terraform plan -var-file="staging.auto.tfvars"
   terraform apply
   ```

## 🔗 Resource Integration

The application infrastructure references base infrastructure outputs:

```hcl
# In Cosine2.0/terraform/main.tf
data "terraform_remote_state" "base_infra" {
  backend = "s3"
  config = {
    bucket = "cosine-terraform-state-bucket"
    key    = "base-infrastructure/staging/terraform.tfstate"
    region = "us-east-1"
  }
}

# Use base infrastructure resources
resource "aws_lambda_function" "api" {
  # ... configuration
  
  environment {
    variables = {
      USER_POOL_ID = data.terraform_remote_state.base_infra.outputs.cognito_user_pool_id
      # ... other variables
    }
  }
}
```

## 📁 State File Organization

```
s3://cosine-terraform-state-bucket/
├── base-infrastructure/
│   ├── development/terraform.tfstate
│   ├── staging/terraform.tfstate
│   └── production/terraform.tfstate
└── application/
    ├── development/terraform.tfstate
    ├── staging/terraform.tfstate
    └── production/terraform.tfstate
```

## 🔄 CI/CD Pipeline Order

1. **Base Infrastructure Pipeline**: Deploys when Cosine-Base-Infra changes
2. **Application Pipeline**: Deploys when Cosine2.0 changes (depends on base)

## ⚠️ Important Notes

- **Bootstrap First**: Always deploy bootstrap before any other infrastructure
- **Base Before App**: Base infrastructure must be deployed before application
- **Environment Isolation**: Each environment has separate state files
- **Admin Access**: Bootstrap requires admin AWS permissions
