# 🚀 Infrastructure Testing Guide

This guide will help you test the new environment-specific infrastructure setup.

## 📋 Pre-Testing Checklist

### 1. AWS Prerequisites
- [ ] AWS CLI installed and configured
- [ ] Valid AWS credentials with appropriate permissions
- [ ] Terraform CLI installed (version >= 1.0)

### 2. Backend Setup (One-Time Only)
If you haven't set up the remote backend yet:

```powershell
# Navigate to infra directory
cd infra

# Initialize and apply backend setup
terraform init
terraform apply -target="aws_s3_bucket.terraform_state" -target="aws_dynamodb_table.terraform_locks"

# Note the bucket name and DynamoDB table name from output
```

Update the backend configuration in both environment files with your actual values:
- `infra/environments/staging/main.tf`
- `infra/environments/production/main.tf`

## 🧪 Testing Staging Environment

### Step 1: Initialize Staging
```powershell
# Navigate to staging environment
cd infra/environments/staging

# Initialize Terraform
terraform init

# Expected output: Backend successfully configured
```

### Step 2: Plan Staging Deployment
```powershell
# Create a plan
terraform plan -out=staging.tfplan

# Review the plan output for:
# - Lambda functions with staging suffix
# - API Gateway with staging configuration  
# - All resources tagged with Environment=staging
```

### Step 3: Apply Staging (if plan looks good)
```powershell
# Apply the plan
terraform apply staging.tfplan

# Expected resources:
# - aws_lambda_function.cosine-portfolio-stats-staging
# - aws_lambda_function.cosine-robinhood-integration-staging
# - aws_api_gateway_rest_api.cosine-robinhood-api-staging
```

### Step 4: Verify Staging Outputs
```powershell
# Get outputs
terraform output

# Expected outputs:
# - api_gateway_url
# - robinhood_api_url  
# - lambda_function_names
# - environment = "staging"
```

## 🔍 Testing Production Environment (Optional)

### Step 1: Initialize Production
```powershell
# Navigate to production environment
cd infra/environments/production

# Initialize Terraform  
terraform init
```

### Step 2: Plan Production Deployment
```powershell
# Create a plan
terraform plan -out=production.tfplan

# Review differences from staging:
# - Resources have production suffix
# - Environment tags show "production"
# - Separate state file
```

### Step 3: Apply Production (Use Caution!)
```powershell
# Only apply if you're ready for production deployment
terraform apply production.tfplan
```

## 🔬 Module Testing

### Verify Module Structure
```powershell
# Check module is being used correctly
cd infra/modules/cosine-app

# Validate module syntax
terraform validate

# Should show: Success! The configuration is valid.
```

## 🌐 GitHub Actions Testing

### Test Workflow Trigger
1. **Create a test branch from develop**:
   ```bash
   git checkout develop
   git checkout -b test/infrastructure-staging
   git push origin test/infrastructure-staging
   ```

2. **Trigger manual workflow**:
   - Go to GitHub Actions tab
   - Run "Terraform Infrastructure" workflow
   - Select "staging" environment
   - Choose "plan" action

3. **Review workflow output**:
   - Verify it navigates to `infra/environments/staging`
   - Check Terraform plan output
   - Ensure no errors in workflow

### Test Production Workflow (if ready)
1. **Test from main branch**:
   ```bash
   git checkout main
   # Push changes or use manual workflow trigger
   ```

2. **Verify production targeting**:
   - Workflow should target `infra/environments/production`
   - More restrictive approval process

## ✅ Validation Checklist

### Infrastructure Validation
- [ ] Staging environment deploys successfully
- [ ] All Lambda functions are created with correct names
- [ ] API Gateway is accessible
- [ ] Resources are properly tagged
- [ ] State file is stored in S3
- [ ] State locking works (try concurrent applies)

### Workflow Validation  
- [ ] GitHub Actions workflow triggers correctly
- [ ] Environment selection works based on branch
- [ ] Terraform plan/apply executes in correct directory
- [ ] Secrets are properly configured
- [ ] Manual workflow dispatch works

### Module Validation
- [ ] Module can be called from both environments
- [ ] Module variables are passed correctly
- [ ] Module outputs are accessible
- [ ] Module syntax is valid

## 🚨 Troubleshooting

### Common Issues

#### 1. Backend Configuration Error
```
Error: Failed to get existing workspaces: S3 bucket does not exist
```
**Solution**: Run the backend setup first or update bucket name.

#### 2. State Lock Error
```
Error: Error acquiring the state lock
```
**Solution**: Wait for other operations to complete or force unlock if needed.

#### 3. Module Path Error
```
Error: Module not installed
```
**Solution**: Run `terraform init` to download modules.

#### 4. Permission Errors
```
Error: AccessDenied: Access Denied
```
**Solution**: Check AWS credentials and IAM permissions.

### Debug Commands
```powershell
# Check Terraform version
terraform version

# Validate configuration
terraform validate

# Show current state
terraform show

# List resources
terraform state list

# Check workspace
terraform workspace show
```

## 📊 Expected Test Results

### Successful Staging Deployment
```
Apply complete! Resources: X added, 0 changed, 0 destroyed.

Outputs:

api_gateway_url = "https://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com/staging"
robinhood_api_url = "https://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com/staging/robinhood"
lambda_function_names = [
  "cosine-portfolio-stats-staging",
  "cosine-robinhood-integration-staging",
]
environment = "staging"
```

### Successful GitHub Actions Workflow
```
✅ Checkout code
✅ Setup Terraform  
✅ Configure AWS credentials
✅ Terraform Init (in infra/environments/staging)
✅ Terraform Plan
✅ Upload Plan Artifact
```

## 🎯 Next Steps After Successful Testing

1. **Clean up test resources** (if desired):
   ```powershell
   cd infra/environments/staging
   terraform destroy
   ```

2. **Remove deprecated files**:
   - Delete `infra/setup-backend.tf` (after backend is created)
   - Archive old root `main.tf`, `variables.tf`, `outputs.tf`

3. **Production deployment**:
   - Deploy to production when ready
   - Set up monitoring and alerting

4. **Team onboarding**:
   - Update team documentation
   - Train team on new workflow

---
**Testing Status**: 🔄 Ready for testing  
**Documentation**: Complete  
**Next Action**: Run staging deployment test
