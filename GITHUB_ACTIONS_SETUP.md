# GitHub Actions CI/CD Setup Guide

This guide explains how to set up and use the GitHub Actions workflows for your Cosine 2.0 investment platform.

## 🚀 Quick Setup

### 1. GitHub Repository Secrets

Add these secrets to your GitHub repository (Settings → Secrets and variables → Actions):

```
AWS_ACCESS_KEY_ID=your_aws_access_key
AWS_SECRET_ACCESS_KEY=your_aws_secret_key
```

### 2. Create GitHub Environments

1. Go to Settings → Environments
2. Create two environments:
   - `staging` (auto-deploy from `develop` branch)
   - `production` (manual approval required, deploys from `main` branch)

3. For production environment, add protection rules:
   - Required reviewers: Add yourself or team members
   - Wait timer: 5 minutes (optional)

## 📋 Available Workflows

### 1. **CI Workflow** (`.github/workflows/ci.yml`)
**Triggers:** Push to any branch, PRs to main/develop

**What it does:**
- ✅ Lints frontend (TypeScript/React) and backend (Python) code
- ✅ Runs unit tests
- ✅ Tests frontend build process
- ✅ Validates Terraform configuration
- ✅ Security scanning with Trivy and tfsec
- ✅ Integration tests with local backend server

### 2. **Deploy Workflow** (`.github/workflows/deploy.yml`)
**Triggers:** Push to `main` or `develop` branches

**What it does:**
- 🏗️ Builds frontend and packages Lambda functions
- 🚀 Deploys infrastructure with Terraform
- 📦 Updates Lambda function code
- 🌐 Deploys frontend to S3 + CloudFront
- ✅ Runs post-deployment health checks
- 🧹 Cleanup preview environments on PR close

### 3. **Terraform Workflow** (`.github/workflows/terraform.yml`)
**Triggers:** Manual workflow dispatch

**What it does:**
- 🎛️ Manual control over Terraform operations
- 📋 Plan, Apply, or Destroy infrastructure
- 🎯 Target specific environments (staging/production)

## 🛠️ Usage Instructions

### Branch Strategy

```
main branch (production)
├── develop branch (staging)
│   ├── feature/robinhood-integration
│   ├── feature/portfolio-analysis
│   └── feature/new-feature
```

### Development Workflow

1. **Create feature branch:**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Push changes:**
   ```bash
   git push origin feature/your-feature-name
   ```
   → Triggers CI workflow (tests & linting)

3. **Create Pull Request to `develop`:**
   → Triggers CI workflow + Terraform plan

4. **Merge to `develop`:**
   → Triggers deployment to staging environment

5. **Create PR from `develop` to `main`:**
   → Triggers CI workflow + production Terraform plan

6. **Merge to `main`:**
   → Triggers deployment to production (with manual approval)

### Manual Infrastructure Operations

Use the Terraform workflow for manual operations:

1. Go to Actions → Terraform Infrastructure
2. Click "Run workflow"
3. Choose:
   - **Action:** plan/apply/destroy
   - **Environment:** staging/production
4. Click "Run workflow"

## 📁 Required Terraform Outputs

Your Terraform configuration should output these values for the deployment workflow:

```hcl
# In your infra/outputs.tf
output "lambda_function_names" {
  description = "Names of Lambda functions to update"
  value = [
    aws_lambda_function.robinhood_api.function_name,
    aws_lambda_function.portfolio_analysis.function_name,
    # Add other Lambda functions
  ]
}

output "frontend_bucket_name" {
  description = "S3 bucket name for frontend hosting"
  value = aws_s3_bucket.frontend.bucket
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID"
  value = aws_cloudfront_distribution.frontend.id
}

output "api_gateway_url" {
  description = "API Gateway URL"
  value = aws_api_gateway_deployment.main.invoke_url
}
```

## 🔧 Configuration

### Environment Variables

Update these in the workflow files if needed:

```yaml
env:
  AWS_REGION: us-east-1  # Change to your preferred region
  NODE_VERSION: '18'     # Node.js version
  PYTHON_VERSION: '3.10' # Python version
  TF_VERSION: 1.6.0      # Terraform version
```

### Frontend Build Configuration

The workflow assumes:
- Frontend is in `frontend/app/`
- Build command: `npm run build`
- Build output: `out/` directory (Next.js static export)

If your setup is different, update the deploy workflow accordingly.

## 🚨 Troubleshooting

### Common Issues

1. **"Module not found" errors in Lambda:**
   - Ensure `requirements.txt` includes all dependencies
   - Check Lambda function packaging in deploy workflow

2. **Terraform state lock:**
   - Use S3 backend with DynamoDB for state locking
   - Consider using Terraform Cloud for better state management

3. **Frontend deployment fails:**
   - Check if S3 bucket exists and is accessible
   - Verify CloudFront distribution is created correctly

4. **GitHub Actions permissions:**
   - Ensure AWS credentials have necessary permissions
   - Check environment protection rules aren't blocking deployment

### Monitoring Deployments

- **GitHub Actions logs:** Real-time deployment progress
- **AWS CloudWatch:** Lambda function logs and metrics
- **AWS S3:** Frontend deployment status
- **AWS CloudFront:** CDN invalidation status

## 📈 Next Steps

1. **Set up monitoring:**
   - Add AWS CloudWatch alarms
   - Set up Slack/email notifications

2. **Enhance security:**
   - Use OIDC instead of long-lived AWS keys
   - Add more comprehensive security scanning

3. **Add more environments:**
   - Development environment for testing
   - Preview environments for feature branches

4. **Database migrations:**
   - Add database migration steps if using RDS
   - Consider using tools like Flyway or Alembic

## 🤝 Contributing

When adding new features:
1. Update tests in `local_dev/tests/`
2. Add environment variables to workflow if needed
3. Update this documentation
4. Test in staging before promoting to production
