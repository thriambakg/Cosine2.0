# 🌐 Complete Website Deployment Guide

## 🚨 CRITICAL FINDINGS

After analyzing your infrastructure, I found **3 major issues** that need to be fixed for your website to work:

### ❌ Issue #1: Frontend Assets Not Deployed
- **Problem**: ECS expects container in ECR, but no build/push process exists
- **Impact**: Website will fail to start - ECR repository is empty
- **Solution**: Use the build scripts I created

### ❌ Issue #2: Cognito Callback URL Mismatch  
- **Problem**: Cognito expects `staging.cosine.app` but your ALB will have different DNS
- **Impact**: Authentication will completely fail
- **Solution**: Update callback URLs to match ALB DNS

### ❌ Issue #3: Domain Configuration Mismatch
- **Problem**: Base infra uses `cosine.app`, frontend infra has no custom domain
- **Impact**: Authentication won't work even if URLs match
- **Solution**: Coordinate domain configuration

## ✅ GOOD NEWS: Infrastructure Is Correct

**Your infrastructure WILL make the website publicly accessible:**
- ✅ ALB configured for public internet (`internal = false`)
- ✅ Security groups allow HTTP/HTTPS from anywhere
- ✅ Public subnets properly configured
- ✅ Health check endpoint exists (`/api/health`)
- ✅ ECS service will be reachable via ALB
- ✅ Cognito authentication properly configured
- ✅ DynamoDB tables ready for user data

## 🔧 COMPLETE FIX PROCESS

### Step 1: Deploy Infrastructure (Both Projects)

```powershell
# Deploy Base Infrastructure first
cd c:\Users\Thriambak\Documents\Code\Cosine-Base-Infra\terraform
terraform init
terraform apply

# Deploy Frontend Infrastructure 
cd c:\Users\Thriambak\Documents\Code\Cosine2.0\terraform
terraform init
terraform apply
```

### Step 2: Get Your Website URL

```powershell
# Get the ALB DNS URL (your live website URL)
cd c:\Users\Thriambak\Documents\Code\Cosine2.0\terraform
terraform output alb_dns_url

# Example output: https://cosine-alb-staging-123456789.us-east-1.elb.amazonaws.com
```

### Step 3: Fix Cognito Callback URLs

**Option A: Use My Automated Script**
```powershell
cd c:\Users\Thriambak\Documents\Code\Cosine2.0
.\scripts\update-cognito-callbacks.ps1 staging
```

**Option B: Manual Update**
```powershell
# Edit: c:\Users\Thriambak\Documents\Code\Cosine-Base-Infra\terraform\environments\staging.auto.tfvars
# Replace cognito_callback_urls with your ALB DNS:

cognito_callback_urls = [
  "https://your-alb-dns.elb.amazonaws.com",
  "https://your-alb-dns.elb.amazonaws.com/auth/callback"
]
cognito_logout_urls = [
  "https://your-alb-dns.elb.amazonaws.com",
  "https://your-alb-dns.elb.amazonaws.com/auth/logout"
]

# Then apply:
cd c:\Users\Thriambak\Documents\Code\Cosine-Base-Infra\terraform
terraform apply
```

### Step 4: Build and Deploy Frontend

**Use My Automated Script**
```powershell
cd c:\Users\Thriambak\Documents\Code\Cosine2.0
.\scripts\build-and-deploy-frontend.ps1 staging
```

**Manual Alternative**
```powershell
# Get ECR URL
cd c:\Users\Thriambak\Documents\Code\Cosine2.0\terraform
$ECR_URL = terraform output -raw ecr_repository_url

# Build and push
cd ..\frontend\app
docker build -t cosine-frontend .
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin $($ECR_URL.Split('/')[0])
docker tag cosine-frontend:latest "$ECR_URL:latest"
docker push "$ECR_URL:latest"
```

### Step 5: Test Your Website

1. **Visit your ALB DNS URL** (from Step 2)
2. **Test authentication** - try logging in
3. **Check ECS service** - AWS Console → ECS → Services
4. **Review logs** - CloudWatch logs for any errors

## 🌐 Expected Results

### Your Live Website URL
```
https://cosine-alb-staging-[random].us-east-1.elb.amazonaws.com
```

### Authentication Features
- ✅ Username/password login
- ✅ Google OAuth login  
- ✅ Microsoft OAuth login
- ✅ User data stored in DynamoDB
- ✅ JWT token validation

### Infrastructure Features  
- ✅ Auto-scaling ECS service
- ✅ Load balancer with health checks
- ✅ WAF protection
- ✅ SSL/TLS encryption
- ✅ CloudWatch monitoring

## 🚨 TROUBLESHOOTING

### Website Not Loading?
```powershell
# Check ECS service status
aws ecs describe-services --cluster cosine-cluster-staging --services cosine-frontend-staging

# Check container logs
aws logs describe-log-streams --log-group-name "/ecs/cosine-frontend-staging"
```

### Authentication Failing?
1. Verify Cognito callback URLs match ALB DNS exactly
2. Check OAuth provider credentials in Secrets Manager
3. Review CloudWatch authentication logs

### Container Not Starting?
1. Verify ECR image was pushed successfully
2. Check ECS task definition environment variables
3. Review container logs in CloudWatch

## 🎯 FINAL CHECKLIST

- [ ] Base infrastructure deployed
- [ ] Frontend infrastructure deployed  
- [ ] ALB DNS URL obtained
- [ ] Cognito callback URLs updated to match ALB DNS
- [ ] Frontend container built and pushed to ECR
- [ ] ECS service running and healthy
- [ ] Website accessible via ALB DNS URL
- [ ] Authentication working (username/password)
- [ ] OAuth providers working (Google/Microsoft)
- [ ] User data being saved to DynamoDB

## 🚀 GOING LIVE

Once everything works with ALB DNS, you can optionally set up a custom domain:

1. **Enable custom domain** in `staging.auto.tfvars`:
   ```hcl
   enable_custom_domain = true
   domain_name = "yourcompany.com"
   ```

2. **Apply terraform** to create Route53 hosted zone

3. **Update domain nameservers** at your registrar

4. **Update Cognito callbacks** to use custom domain

Your website will be live and fully functional! 🎉
