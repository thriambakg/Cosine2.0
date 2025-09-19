# 🌐 Website URL Configuration Guide

## ✅ Syntax Errors Fixed!

The syntax errors in your `main.tf` have been resolved by:

1. **Removed duplicate data source declarations** - Fixed the redundant `aws_caller_identity` and `aws_region` data sources
2. **Added comprehensive domain module** - New custom domain configuration with Route53 and SSL certificates
3. **Enhanced URL outputs** - Both ALB DNS and custom domain URLs are now available
4. **Updated ALB certificate logic** - ALB now uses custom domain certificate when available

## 🚀 Your Live Website URLs

### Option 1: ALB DNS URL (Available Immediately)
After running `terraform apply`, your website will be immediately available at:
- **Staging**: `https://your-alb-dns-name.elb.amazonaws.com`
- **Production**: `https://your-alb-dns-name.elb.amazonaws.com`

The exact URL will be shown in the terraform output `alb_dns_url` after deployment.

### Option 2: Custom Domain (Professional URLs)
For custom domains like `https://staging.yourcompany.com`:

1. **Enable in terraform variables**:
   ```hcl
   # In staging.auto.tfvars
   enable_custom_domain = true
   domain_name = "yourcompany.com"
   staging_subdomain = "staging"
   production_subdomain = ""  # empty = root domain
   ```

2. **Deploy infrastructure**:
   ```bash
   terraform apply
   ```

3. **Update DNS nameservers** (shown in terraform output):
   - Log into your domain registrar
   - Update nameservers to the Route53 nameservers from terraform output
   - Wait 24-48 hours for DNS propagation

4. **Your live URLs will be**:
   - **Staging**: `https://staging.yourcompany.com`
   - **Production**: `https://yourcompany.com`

## 🔧 Deployment Steps for Live Website

### Step 1: Build and Deploy Infrastructure
```bash
cd c:\Users\Thriambak\Documents\Code\Cosine2.0\terraform

# Deploy staging
terraform workspace select staging  # or use environment-specific backend
terraform apply

# Deploy production  
terraform workspace select production
terraform apply
```

### Step 2: Get Your URLs
After deployment, run:
```bash
terraform output website_access_info
terraform output frontend_url
terraform output alb_dns_url
```

### Step 3: Build and Push Frontend Container
```bash
# Build your frontend container
docker build -t cosine-frontend .

# Tag for ECR (URL from terraform output)
docker tag cosine-frontend:latest [ECR_REPOSITORY_URL]:latest

# Push to ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin [ECR_REPOSITORY_URL]
docker push [ECR_REPOSITORY_URL]:latest
```

### Step 4: Verify Deployment
Your ECS service will automatically pull the latest container and your website will be live!

## 📊 What You Get After Deployment

### Infrastructure Outputs
- `frontend_url` - Primary URL for your website
- `alb_dns_url` - Direct ALB DNS URL (always available)
- `custom_domain_url` - Custom domain URL (if enabled)
- `website_access_info` - Complete access information and setup instructions

### Authentication Ready
- ✅ Cognito User Pool with Google & Microsoft OAuth
- ✅ Username/password authentication
- ✅ JWT token validation
- ✅ Federated login options

### Database Integration
- ✅ DynamoDB tables for user data
- ✅ User profiles, security events, sessions
- ✅ Automatic IAM permissions for ECS tasks

### Production Features
- ✅ SSL/TLS certificates (ALB + custom domain)
- ✅ WAF protection against attacks
- ✅ Auto-scaling ECS service
- ✅ CloudWatch logging and monitoring
- ✅ VPC security with private subnets

## 🌍 Environment-Specific URLs

### Staging Environment
- **Current**: ALB DNS URL (immediate)
- **With custom domain**: `https://staging.yourcompany.com`
- **Purpose**: Testing and validation before production

### Production Environment  
- **Current**: ALB DNS URL (immediate)
- **With custom domain**: `https://yourcompany.com`
- **Purpose**: Live website for your users

## 🔗 Next Steps

1. **Deploy staging first**: `terraform apply` in staging environment
2. **Test your website**: Visit the ALB DNS URL to verify everything works
3. **Set up custom domain**: Update `staging.auto.tfvars` with your domain
4. **Deploy production**: `terraform apply` in production environment
5. **Configure DNS**: Update nameservers at your domain registrar

Your website will be live and ready for users! 🎉

## 📞 Troubleshooting

**Website not loading?**
- Check ECS service is running: AWS Console → ECS → Services
- Verify container image was pushed to ECR
- Check ALB target group health

**Custom domain not working?**
- Verify DNS nameservers are updated at registrar
- Allow 24-48 hours for DNS propagation
- Check Route53 hosted zone has correct records

**Authentication issues?**
- Verify Cognito callback URLs include your domain
- Check environment variables in ECS container
- Review CloudWatch logs for authentication errors
