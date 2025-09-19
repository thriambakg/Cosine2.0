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

### Manual Infrastructure Operations TEstinut

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

### Troubleshooting: No Workflows Appearing

If you don't see any workflow runs in the Actions tab:

#### 1. **Verify Branch Triggers**
Check that you're pushing to the correct branches:
- `develop` branch → Triggers CI and Deploy workflows
- `main` branch → Triggers CI and Deploy workflows  
- `feature/*` → Triggers CI workflow only

#### 2. **Ensure Workflows Are Committed**
```bash
# Check if workflow files are committed and pushed
git status
git ls-tree HEAD .github/workflows/

# If not committed, add and push them
git add .github/workflows/
git commit -m "feat: add GitHub Actions workflows"
git push origin develop
```

#### 3. **Force Trigger a Test**
```bash
# Make a small change to trigger workflows
echo "# Test" >> README.md
git add README.md  
git commit -m "test: trigger workflows"
git push origin develop
```

#### 4. **Check Repository Settings**
- Go to Settings → Actions → General
- Ensure "Allow all actions and reusable workflows" is selected
- Verify Actions are enabled for your repository

#### 5. **Manual Workflow Trigger**
- Go to Actions tab → "Terraform Infrastructure"
- Click "Run workflow" to manually trigger
- This helps verify your setup is working

### Monitoring Deployments

- **GitHub Actions logs:** Real-time deployment progress
- **AWS CloudWatch:** Lambda function logs and metrics
- **AWS S3:** Frontend deployment status
- **AWS CloudFront:** CDN invalidation status

## 📊 Monitoring Your Pipeline

### Real-Time Progress Tracking

After pushing to your repository, you can monitor your pipeline in several ways:

#### 1. **GitHub Actions Tab** (Primary Method)
1. Go to your repository on GitHub
2. Click the **"Actions"** tab
3. Find your latest workflow run (should be at the top)
4. Click on the run to see:
   - ✅ Live status of each job
   - 📝 Real-time logs
   - ⏱️ Step-by-step progress
   - 🔍 Detailed error messages if any fail

#### 2. **Repository Homepage Status**
- Look for status indicators next to your latest commit:
  - 🟡 **Yellow dot** = Currently running
  - ✅ **Green checkmark** = Successfully completed
  - ❌ **Red X** = Failed
  - 🔵 **Blue dot** = Pending/queued

#### 3. **Branch Status**
- On your branch page, you'll see workflow status
- Click the status to jump to the workflow details

### Setting Up Notifications

Configure notifications to get alerts when workflows complete:

1. **GitHub Notifications:**
   - Go to Settings → Notifications
   - Enable "Actions" under "Participating and @mentions"

2. **Email Notifications:**
   - Automatically sent for failed workflows
   - Can be configured for successful ones too

3. **Slack Integration** (Optional):
   ```yaml
   # Add to your workflow file
   - name: Slack Notification
     if: always()
     uses: 8398a7/action-slack@v3
     with:
       status: ${{ job.status }}
       webhook_url: ${{ secrets.SLACK_WEBHOOK }}
   ```

### What to Look For

When monitoring your pipeline:
- **Environment Detection**: Verify it's deploying to the correct environment (staging/production)
- **Terraform Steps**: Watch for plan/apply success
- **Build Steps**: Frontend build and Lambda packaging
- **Deployment Steps**: Infrastructure updates and code deployment

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
