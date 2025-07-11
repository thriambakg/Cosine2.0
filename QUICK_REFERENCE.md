# 🎯 Quick Reference: Environment-Specific Infrastructure

## 📁 Directory Navigation

### Staging Environment
```powershell
cd infra/environments/staging
terraform init
terraform plan
terraform apply
```

### Production Environment  
```powershell
cd infra/environments/production
terraform init
terraform plan
terraform apply
```

### Module Development
```powershell
cd infra/modules/cosine-app
terraform validate
```

## 🔄 Git Workflow

| Branch | Environment | Action |
|--------|-------------|---------|
| `develop` | Staging | Auto-deploy on push |
| `main` | Production | Auto-deploy on push |
| `feature/*` | None | CI tests only |

## 🛠️ Common Commands

### Quick Deploy to Staging
```powershell
git checkout develop
git add .
git commit -m "feat: update infrastructure"
git push origin develop
# ✅ Triggers staging deployment
```

### Manual Infrastructure Operations
```powershell
# Plan only (safe)
cd infra/environments/staging
terraform plan

# Apply with approval
terraform apply

# Destroy environment (careful!)
terraform destroy
```

### GitHub Actions Manual Trigger
1. Go to GitHub Actions tab
2. Select "Terraform Infrastructure" workflow
3. Click "Run workflow"
4. Choose environment and action

## 📂 File Locations

| Component | Location |
|-----------|----------|
| Staging Config | `infra/environments/staging/` |
| Production Config | `infra/environments/production/` |
| Shared Module | `infra/modules/cosine-app/` |
| Workflows | `.github/workflows/` |
| Documentation | `*.md` files in root |

## 🔧 Configuration Files

### Environment-Specific
- `main.tf` - Module instantiation
- `variables.tf` - Environment variables
- `outputs.tf` - Environment outputs

### Module Files  
- `main.tf` - All infrastructure resources
- `variables.tf` - Input parameters
- `outputs.tf` - Resource outputs

## 🚀 Deployment Status

- ✅ Infrastructure reorganized
- ✅ Environment separation complete
- ✅ GitHub Actions configured
- ✅ Documentation created
- 🔄 Ready for testing
- ⏳ Awaiting staging deployment test

## 🆘 Quick Troubleshooting

| Issue | Solution |
|-------|----------|
| Module not found | Run `terraform init` |
| State lock error | Wait or force unlock |
| Backend error | Check S3 bucket exists |
| Permission denied | Verify AWS credentials |
| Plan fails | Check syntax with `terraform validate` |

---
**Structure**: ✅ Complete  
**Testing**: 🔄 Ready  
**Next**: Deploy to staging
