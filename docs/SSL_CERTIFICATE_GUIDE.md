# SSL Certificate Setup Guide for Cosine Application

## 🔍 Current Issue Analysis

Your website shows "Not Secure" because you're using a **self-signed certificate**. While your HTTPS configuration is correct, browsers don't trust self-signed certificates.

### Current Configuration:
- ✅ **HTTPS Listener**: Properly configured on ALB
- ✅ **Certificate Domain**: Now matches ALB (`*.us-east-1.elb.amazonaws.com`)
- ❌ **Self-Signed**: Not trusted by browsers
- ❌ **Browser Warning**: Shows "Not Secure" despite HTTPS

## 🛠️ Solution Options

### Option 1: AWS Certificate Manager with Custom Domain (Recommended)

**Benefits:**
- ✅ Trusted by all browsers
- ✅ Automatic renewal
- ✅ Professional appearance
- ✅ Free from AWS

**Requirements:**
- Own a domain name (e.g., `mycompany.com`)
- Configure DNS with Route53 or external provider

**Setup Steps:**

1. **Purchase/Configure Domain**
   ```bash
   # Example domains you could use:
   # - cosineapp.com
   # - mycompany.com
   # - yourname.dev
   ```

2. **Enable Custom Domain in Terraform**
   ```bash
   # Edit terraform/environments/staging.auto.tfvars
   enable_custom_domain = true
   domain_name = "your-domain.com"
   ```

3. **Apply Infrastructure Changes**
   ```bash
   cd terraform
   terraform plan
   terraform apply
   ```

4. **Configure DNS**
   - Update nameservers to Route53 (if using AWS)
   - Or create CNAME records with your DNS provider

### Option 2: CloudFlare with Free SSL

**Benefits:**
- ✅ Free trusted certificates
- ✅ CDN and performance benefits
- ✅ DDoS protection
- ✅ Works with any domain

**Setup Steps:**

1. **Register domain with CloudFlare or transfer DNS**
2. **Enable CloudFlare proxy**
3. **Update ALB to accept traffic from CloudFlare IPs**
4. **Configure CloudFlare SSL settings**

### Option 3: Let's Encrypt with Custom Setup

**Benefits:**
- ✅ Free trusted certificates
- ✅ Widely supported
- ✅ Automatic renewal possible

**Challenges:**
- ❌ More complex setup
- ❌ Requires DNS validation
- ❌ Manual renewal process

### Option 4: Accept Self-Signed for Staging (Current)

**For Development/Staging Only:**
- ✅ Quick setup
- ✅ Satisfies OAuth requirements
- ❌ Browser warnings persist
- ❌ **OAuth Authentication Fails**: Google/Microsoft reject self-signed certificates
- ❌ Not suitable for production

**⚠️ Important**: Self-signed certificates cause OAuth authentication failures. OAuth providers require trusted SSL certificates, which is why Google login is failing.

## 🚀 Quick Fix for Staging Environment

If you want to eliminate the browser warning for now, you can:

### Temporarily Use HTTP-Only (Not Recommended)

```bash
# Edit terraform/environments/staging.auto.tfvars
certificate_arn = ""
```

**Warning:** This will break OAuth if configured to require HTTPS.

### Browser Exception (For Testing)

1. **Chrome**: Click "Advanced" → "Proceed to site (unsafe)"
2. **Firefox**: Click "Advanced" → "Accept the Risk and Continue"
3. **Edge**: Click "Advanced" → "Continue to site"

## 🎯 Recommended Next Steps

1. **Immediate (Testing)**: Accept browser security warning for staging
2. **Short-term**: Purchase domain and enable custom domain configuration
3. **Long-term**: Set up proper DNS and SSL certificate management

## 📋 Custom Domain Setup Template

If you decide to use a custom domain, here's the complete configuration:

```hcl
# terraform/environments/staging.auto.tfvars
enable_custom_domain = true
domain_name = "your-domain.com"  # Replace with actual domain
staging_subdomain = "staging"    # Creates staging.your-domain.com
production_subdomain = ""        # Creates your-domain.com for production

# Remove self-signed certificate
certificate_arn = ""
```

## 🔧 Testing SSL Configuration

After implementing any solution, test with:

```bash
# Test SSL certificate
openssl s_client -connect your-domain.com:443 -servername your-domain.com

# Check certificate details
curl -vI https://your-domain.com

# Browser test
# Visit https://your-domain.com and verify green lock icon
```

## 📞 Support

- **Domain Registration**: Namecheap, GoDaddy, AWS Route53
- **DNS Management**: CloudFlare, AWS Route53, your domain registrar
- **SSL Testing**: SSL Labs SSL Test (ssllabs.com/ssltest/)

---

**Current Status**: Your HTTPS infrastructure is correctly configured. The only remaining issue is certificate trust, which requires a domain and proper CA-issued certificate.
