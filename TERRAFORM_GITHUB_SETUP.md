# GitHub Actions + Terraform Setup Instructions

## ⚠️ **IMPORTANT: Complete These Steps BEFORE Pushing to GitHub**

### **Step 1: Set Up AWS Backend (One-Time Setup)**

```powershell
# Navigate to infra directory
cd infra

# FIRST: Create the backend infrastructure (S3 + DynamoDB)
# Edit setup-backend.tf and change the bucket name to something unique
terraform init
terraform apply -auto-approve

# IMPORTANT: Note the bucket name and DynamoDB table name from the output
```

### **Step 2: Configure Remote State**

```powershell
# Edit backend.tf and update these values with YOUR unique names:
# bucket = "your-unique-bucket-name"  
# key = "cosine2.0/terraform.tfstate"
# region = "your-preferred-region"
# dynamodb_table = "your-table-name"

# Initialize with remote backend
terraform init

# Type "yes" when prompted to migrate state to remote backend
```

### **Step 3: Clean Up Local Files**

```powershell
# Remove files that shouldn't be in git
Remove-Item "terraform.tfstate*" -Force -ErrorAction SilentlyContinue
Remove-Item "lambda_function.zip" -Force -ErrorAction SilentlyContinue
Remove-Item "robinhood_lambda_function.zip" -Force -ErrorAction SilentlyContinue
Remove-Item "setup_lambda_package.ps1" -Force -ErrorAction SilentlyContinue
Remove-Item "setup_lambda_package.sh" -Force -ErrorAction SilentlyContinue

# Remove the backend setup file (no longer needed)
Remove-Item "setup-backend.tf" -Force
```

### **Step 4: Test Terraform Configuration**

```powershell
# Validate configuration
terraform validate

# Format code
terraform fmt

# Plan deployment
terraform plan -var="environment=staging"
```

### **Step 5: Create AWS IAM User for GitHub Actions**

1. Go to AWS IAM Console
2. Create a new user: `github-actions-cosine`
3. Attach these policies:
   - `PowerUserAccess` (or create a custom policy with minimal permissions)
4. Create Access Keys (save them securely)

### **Step 6: Set Up GitHub Repository**

```powershell
# Initialize git (if not already done)
git init
git add .
git commit -m "Initial commit with Terraform infrastructure"

# Create GitHub repository and push
# Follow GitHub's instructions to create a new repository
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git branch -M main
git push -u origin main
```

### **Step 7: Configure GitHub Secrets**

Go to your GitHub repository → Settings → Secrets and variables → Actions

Add these Repository Secrets:
```
AWS_ACCESS_KEY_ID=your_access_key_here
AWS_SECRET_ACCESS_KEY=your_secret_key_here
```

### **Step 8: Create GitHub Environments**

1. Go to Settings → Environments
2. Create `staging` environment:
   - No protection rules needed
3. Create `production` environment:
   - Add protection rules:
     - ✅ Required reviewers: Add yourself
     - ✅ Wait timer: 5 minutes (optional)

### **Step 9: Test GitHub Actions**

```powershell
# Create a feature branch
git checkout -b feature/test-pipeline

# Make a small change (like updating a comment in main.tf)
# Commit and push
git add .
git commit -m "Test GitHub Actions pipeline"
git push origin feature/test-pipeline

# Create a Pull Request to main branch
# This should trigger the CI workflow
```

### **Step 10: Deploy to Staging**

```powershell
# Merge your feature branch to develop (create develop branch first)
git checkout -b develop
git push origin develop

# This should trigger deployment to staging environment
```

### **Step 11: Deploy to Production**

```powershell
# Create PR from develop to main
# After approval and merge, this will deploy to production
```

## 🎯 **Expected File Structure After Setup**

```
infra/
├── backend.tf          # Remote state configuration
├── main.tf            # Main infrastructure
├── variables.tf       # Input variables
├── outputs.tf         # Output values
├── providers.tf       # Provider configuration
├── .terraform.lock.hcl # Provider version lock
└── .terraform/        # Terraform cache (ignored by git)
```

## ✅ **Validation Checklist**

- [ ] AWS backend is created and configured
- [ ] Local state files are removed
- [ ] Terraform validates without errors
- [ ] GitHub repository is created
- [ ] GitHub secrets are configured
- [ ] GitHub environments are set up
- [ ] CI workflow runs successfully on PR
- [ ] Deployment workflow works for staging

## 🔧 **Troubleshooting**

### Issue: "Backend initialization required"
**Solution:** Run `terraform init` in the infra directory

### Issue: "Access denied" during deployment
**Solution:** Check AWS IAM permissions for GitHub Actions user

### Issue: "State file conflicts"
**Solution:** Ensure remote backend is properly configured and local state files are deleted

### Issue: "Lambda deployment fails"
**Solution:** Check that the GitHub Actions workflow can access your source code properly

## 📞 **Need Help?**

Check the GitHub Actions logs for detailed error messages:
- Go to your repository → Actions
- Click on the failed workflow
- Expand the failed step to see logs

The logs will tell you exactly what went wrong and how to fix it.
