# Production Deployment Checklist for investcosine.com

## 🎯 **Pre-Deployment Configuration Review**

### ✅ **Domain Configuration**
- **Domain Acquired**: investcosine.com ✅
- **Production URL**: https://investcosine.com
- **Staging URL**: https://staging.investcosine.com (if deployed)

### ✅ **Configuration Files Updated**

#### **Application Infrastructure (Cosine2.0)**
- ✅ **Domain**: Updated to `investcosine.com`
- ✅ **Custom Domain**: Enabled (`enable_custom_domain = true`)
- ✅ **WAF Settings**: Production-ready (rate limit: 1000, geo-blocking enabled)
- ✅ **Security**: Enhanced for production

#### **Base Infrastructure (Cognito/DynamoDB)**
- ✅ **OAuth Callbacks**: Updated for `investcosine.com`
- ✅ **Security**: MFA enabled, advanced security enforced
- ✅ **Token Validity**: 30 minutes (more secure)
- ✅ **Monitoring**: Extended log retention (365 days)

### 🔄 **Key Differences: Staging vs Production**

| Feature | Staging | Production |
|---------|---------|------------|
| **Domain** | ALB URL | investcosine.com |
| **SSL Certificate** | Self-signed | AWS ACM (trusted) |
| **OAuth** | ❌ Fails (self-signed) | ✅ Works (trusted SSL) |
| **MFA** | Optional | Required |
| **WAF Rate Limit** | 2000 req/5min | 1000 req/5min |
| **Geo-blocking** | None | China, Russia, N.Korea |
| **Log Retention** | 30 days | 365 days |
| **DynamoDB** | Basic | Point-in-time recovery |

## 🚀 **Deployment Steps**

### **Step 1: Deploy Base Infrastructure First**
```bash
cd Cosine-Base-Infra/terraform
terraform init
terraform workspace select production  # or create if doesn't exist
terraform plan -var-file="environments/production.auto.tfvars"
terraform apply -var-file="environments/production.auto.tfvars"
```

### **Step 2: Deploy Application Infrastructure**
```bash
cd Cosine2.0/terraform
terraform init
terraform workspace select production  # or create if doesn't exist
terraform plan -var-file="environments/production.auto.tfvars"
terraform apply -var-file="environments/production.auto.tfvars"
```

### **Step 3: Configure DNS (Route53)**
After Terraform deployment:
1. ✅ **Hosted Zone**: Will be created automatically
2. ✅ **Name Servers**: Update your domain registrar
3. ✅ **SSL Certificate**: Will be issued automatically by AWS ACM
4. ✅ **DNS Validation**: Will be handled automatically

### **Step 4: Frontend Deployment**
```bash
# Build and push production container
cd frontend
docker build -t cosine-frontend:production .
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 676206904242.dkr.ecr.us-east-1.amazonaws.com
docker tag cosine-frontend:production 676206904242.dkr.ecr.us-east-1.amazonaws.com/cosine-frontend-production:latest
docker push 676206904242.dkr.ecr.us-east-1.amazonaws.com/cosine-frontend-production:latest
```

## 🔧 **Post-Deployment Verification**

### **1. SSL Certificate Validation**
```bash
# Test SSL certificate
curl -I https://investcosine.com
openssl s_client -connect investcosine.com:443 -servername investcosine.com

# Expected: Green lock icon in browser, no security warnings
```

### **2. OAuth Authentication Test**
- ✅ **Google Login**: Should work (trusted SSL)
- ✅ **Microsoft Login**: Should work (trusted SSL)
- ✅ **Username/Password**: Should work

### **3. Performance Verification**
- ✅ **CloudFront**: CDN enabled for global distribution
- ✅ **WAF**: DDoS protection active
- ✅ **ALB**: Health checks passing

### **4. Security Verification**
- ✅ **HTTPS Redirect**: HTTP → HTTPS automatic
- ✅ **Security Headers**: HSTS, CSP, XSS protection
- ✅ **Rate Limiting**: 1000 requests per 5 minutes
- ✅ **Geo-blocking**: High-risk countries blocked

## ⚠️ **Important Notes**

### **Domain Propagation**
- **DNS Updates**: Can take 24-48 hours globally
- **Certificate Validation**: 5-10 minutes after DNS propagation
- **Testing**: Use `https://investcosine.com` after deployment

### **OAuth Callback URLs**
Your production Cognito will be configured with:
- `https://investcosine.com/auth/callback`
- `https://www.investcosine.com/auth/callback`

### **Environment Variables (Production)**
```bash
NEXT_PUBLIC_COGNITO_USER_POOL_ID=us-east-1_XXXXXXXXX  # Will be different from staging
NEXT_PUBLIC_COGNITO_CLIENT_ID=XXXXXXXXXXXXXXXXXX      # Will be different from staging
NEXT_PUBLIC_COGNITO_DOMAIN=cosine-production          # Production Cognito domain
```

## 🆘 **Rollback Plan**

If issues occur:
```bash
# Quick rollback to staging
git checkout staging
terraform workspace select staging
terraform apply

# Or destroy production if needed
terraform workspace select production
terraform destroy -var-file="environments/production.auto.tfvars"
```

## 📋 **Success Criteria**

After deployment, verify:
- [ ] https://investcosine.com loads with green lock icon
- [ ] Google OAuth login works
- [ ] Microsoft OAuth login works  
- [ ] No browser security warnings
- [ ] Performance is acceptable globally
- [ ] All functionality from staging works

## 🎉 **Ready for Production!**

Your configuration is properly set up for production deployment with:
- ✅ **Professional Domain**: investcosine.com
- ✅ **Trusted SSL**: AWS Certificate Manager
- ✅ **OAuth Ready**: Will work with trusted certificates
- ✅ **Enterprise Security**: MFA, WAF, geo-blocking
- ✅ **Global Performance**: CloudFront CDN
- ✅ **Compliance Ready**: Extended logging, encryption

**Next**: Run the deployment steps above and your production environment will be live!
