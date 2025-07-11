# Infrastructure Structure

This directory contains the Terraform infrastructure for the Cosine 2.0 investment platform.

## 📁 Directory Structure

```
infra/
├── environments/           # Environment-specific configurations
│   ├── staging/           # Staging environment
│   │   ├── main.tf        # Staging configuration
│   │   ├── variables.tf   # Staging variables
│   │   └── outputs.tf     # Staging outputs
│   └── production/        # Production environment
│       ├── main.tf        # Production configuration
│       ├── variables.tf   # Production variables
│       └── outputs.tf     # Production outputs
├── modules/               # Reusable Terraform modules
│   └── cosine-app/        # Main application module
│       ├── main.tf        # Module resources
│       ├── variables.tf   # Module variables
│       └── outputs.tf     # Module outputs
└── setup-backend.tf       # One-time backend setup (remove after use)
```

## 🚀 Quick Start

### 1. Set Up Backend (One-Time)

```bash
# Edit setup-backend.tf with unique bucket name
cd infra
terraform init
terraform apply -auto-approve

# Note the output values for next step
```

### 2. Configure Environment Backend

Update the backend configuration in both environment files:
- `environments/staging/main.tf`
- `environments/production/main.tf`

```hcl
backend "s3" {
  bucket         = "your-unique-bucket-name"
  key            = "cosine2.0/staging/terraform.tfstate"  # or production
  region         = "us-east-1"
  dynamodb_table = "your-table-name"
  encrypt        = true
}
```

### 3. Initialize Environments

```bash
# Staging
cd environments/staging
terraform init
terraform plan
terraform apply

# Production
cd ../production
terraform init
terraform plan
terraform apply
```

## 🔧 Environment Differences

### Staging
- **Log Level**: INFO (more verbose)
- **Lambda Timeout**: 60 seconds
- **Resource Naming**: `cosine-*-staging`
- **Tags**: Environment = "staging"

### Production
- **Log Level**: WARNING (less verbose)
- **Lambda Timeout**: 90 seconds (more resilient)
- **Resource Naming**: `cosine-*-production`
- **Tags**: Environment = "production"

## 📋 GitHub Actions Integration

The GitHub Actions workflows automatically select the correct environment:

- **Push to `develop`** → Deploys to `staging`
- **Push to `main`** → Deploys to `production`
- **Pull Requests** → Plans against `staging`

### Workflow Commands

```bash
# The workflows automatically run:
cd infra/environments/$ENVIRONMENT
terraform init
terraform plan
terraform apply -auto-approve
```

## 🏗️ Module Structure

The `cosine-app` module contains all the infrastructure resources:

- **Lambda Functions**: Portfolio stats & Robinhood integration
- **API Gateway**: REST API with CORS support
- **IAM Roles**: Lambda execution roles with minimal permissions
- **CloudWatch**: Logging and monitoring (automatic)

## 🔒 Security Features

- **Separate State Files**: Each environment has isolated state
- **Environment Tagging**: All resources tagged by environment
- **IAM Least Privilege**: Minimal required permissions
- **Encryption**: State files encrypted in S3
- **State Locking**: DynamoDB prevents concurrent modifications

## 📊 Outputs

Each environment outputs the following for GitHub Actions:

```hcl
lambda_function_names           # For code deployment
api_gateway_url                # For frontend configuration
robinhood_api_url              # For direct API access
robinhood_lambda_function_name # For individual updates
portfolio_stats_lambda_function_name
environment                    # Current environment
aws_region                     # Deployment region
```

## 🛠️ Local Development

To test locally against staging:

```bash
cd environments/staging
terraform plan
terraform apply

# Get the API URL
terraform output robinhood_api_url
```

## 📝 Adding Resources

To add new resources:

1. **Add to Module**: Edit `modules/cosine-app/main.tf`
2. **Add Variables**: Edit `modules/cosine-app/variables.tf` if needed
3. **Add Outputs**: Edit `modules/cosine-app/outputs.tf` if needed
4. **Test Staging**: Apply to staging first
5. **Deploy Production**: Merge to main branch

## 🔄 State Management

Each environment maintains separate state:

- **Staging**: `s3://bucket/cosine2.0/staging/terraform.tfstate`
- **Production**: `s3://bucket/cosine2.0/production/terraform.tfstate`

This prevents accidental cross-environment impacts.

## 🚨 Troubleshooting

### "Backend not configured"
```bash
cd environments/staging  # or production
terraform init
```

### "State lock"
```bash
# Check DynamoDB table for stuck locks
# Or force unlock (use carefully):
terraform force-unlock LOCK_ID
```

### "Module not found"
```bash
# Ensure you're in the correct directory:
cd environments/staging
terraform get
terraform init
```

## 📞 Need Help?

Check the deployment logs in GitHub Actions for detailed error messages and troubleshooting steps.
