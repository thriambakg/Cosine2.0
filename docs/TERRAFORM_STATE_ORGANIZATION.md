# Terraform State File Organization

This document explains the proper state file organization for the Cosine project.

## 📁 S3 Bucket Structure

### Base Infrastructure (`Cosine-Base-Infra`)
```
cosine-terraform-state-bucket/
├── base-infrastructure/
│   ├── production/terraform.tfstate
│   ├── staging/terraform.tfstate
│   └── development/terraform.tfstate
```

### Application Infrastructure (`Cosine2.0`)
```
cosine-terraform-state-bucket/
├── application/
│   ├── production/terraform.tfstate
│   ├── staging/terraform.tfstate
│   └── development/terraform.tfstate
```

## 🔧 Local Development Commands

### Base Infrastructure
```bash
cd Cosine-Base-Infra/terraform

# Production
terraform init -backend-config="backend-configs/production.tfbackend"
terraform plan -var-file="environments/production.auto.tfvars"

# Staging  
terraform init -backend-config="backend-configs/staging.tfbackend"
terraform plan -var-file="environments/staging.auto.tfvars"

# Development
terraform init -backend-config="backend-configs/development.tfbackend"
terraform plan -var-file="environments/development.auto.tfvars"
```

### Application Infrastructure
```bash
cd Cosine2.0/terraform

# Production
terraform init -backend-config="backend-configs/production.tfbackend"
terraform plan -var-file="environments/production.auto.tfvars"

# Staging
terraform init -backend-config="backend-configs/staging.tfbackend"  
terraform plan -var-file="environments/staging.auto.tfvars"

# Development
terraform init -backend-config="backend-configs/development.tfbackend"
terraform plan -var-file="environments/development.auto.tfvars"
```

## 🚀 GitHub Actions (Automatic)

The GitHub Actions workflows automatically:
1. Detect the environment based on branch name
2. Use the correct backend config file  
3. Use the correct environment variables file
4. Deploy to the appropriate environment

### Branch → Environment Mapping
- `main` branch → `production` environment
- `prod` branch → `production` environment  
- `develop` branch → `staging` environment
- `staging` branch → `staging` environment
- Other branches → `development` environment

### 🔒 Environment Protection Rules

If you encounter **"Branch 'prod' is not allowed to deploy to production"** errors:

#### Solution 1: Update GitHub Environment Settings
1. Go to **Repository Settings** → **Environments** → **production**
2. In **Deployment branches**, add `prod` to allowed branches
3. Or update pattern to `main|prod`

#### Solution 2: Use Manual Deployment (Recommended for Production)
```bash
# Go to GitHub Actions tab in your repository
# Click "Deploy Application Infrastructure" 
# Click "Run workflow"
# Select "production" environment
# Click "Run workflow"
```

#### Solution 3: Merge to Main Branch
```bash
# Merge your prod branch to main for production deployment
git checkout main
git merge prod
git push origin main
```

## ✅ Benefits

1. **Environment Isolation**: Each environment has its own state file
2. **No State Conflicts**: Switching environments doesn't cause state issues
3. **Parallel Deployments**: Different environments can be deployed simultaneously
4. **Clean Rollbacks**: Each environment maintains its own state history
5. **Security**: Production state is isolated from staging/development

## ⚠️ Important Notes

- Always use the backend config files for initialization
- Never mix state files between environments
- Each environment maintains independent resource tracking
- State locking prevents concurrent modifications across all environments
