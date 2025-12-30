# Stripe Keys Setup Guide

## Key Locations

### ✅ Frontend: Publishable Key (GitHub Secrets)
**Location:** GitHub Repository → Settings → Secrets and variables → Actions

**Secret Name:** `STRIPE_PUBLISHABLE_KEY`

**Value:** `pk_test_51SjyGfFUW8hKUxSHYvNtCXue1PvcPEADOxulsHBUM5ryRCjlGH7AVipVjTVsB9HKIkqfcdoNMv4qJFs0hndt76VO00HBabefLS`

**Why GitHub Secrets?** 
- Publishable keys are safe to expose in frontend code
- They're injected during build time
- No need for AWS Secrets Manager

---

### ✅ Backend: Stripe Secrets (AWS Secrets Manager - Consolidated)
**Location:** AWS Console → Secrets Manager → `cosine-production-stripe-production`

**Update the JSON to:**
```json
{
  "stripe_secret_key": "sk_test_YOUR_ACTUAL_SECRET_KEY",
  "secret_key": "sk_test_YOUR_ACTUAL_SECRET_KEY",
  "webhook_secret": "whsec_YOUR_WEBHOOK_SECRET",
  "secret": "whsec_YOUR_WEBHOOK_SECRET"
}
```

**Where to get the keys:**
- **Secret Key:** Stripe Dashboard → Developers → API keys → Copy "Secret key" (starts with `sk_test_` or `sk_live_`)
- **Webhook Secret:** 
  1. Stripe Dashboard → Developers → Webhooks
  2. Create endpoint: `https://YOUR_API_GATEWAY_URL/production/billing-payment`
  3. Select events: `payment_intent.succeeded`, `payment_intent.payment_failed`
  4. Copy the "Signing secret" (starts with `whsec_`)

**Why AWS Secrets Manager?**
- Secret keys must NEVER be exposed to frontend
- Webhook secret used to verify webhook signatures
- Lambda fetches both securely at runtime
- Encrypted at rest with KMS

---

## Quick Reference

| Key Type | Location | Secret/Key Name | Example Value |
|----------|----------|----------------|---------------|
| Publishable | GitHub Secrets | `STRIPE_PUBLISHABLE_KEY` | `pk_test_...` |
| Secret | AWS Secrets Manager | `cosine-production-stripe-production` → `stripe_secret_key` | `sk_test_...` |
| Webhook | AWS Secrets Manager | `cosine-production-stripe-production` → `webhook_secret` | `whsec_...` |

---

## Important Notes

1. **Never put publishable key in AWS Secrets Manager** - It's safe for frontend
2. **Never put secret key in GitHub Secrets** - It would be exposed in frontend
3. **Both `stripe_secret_key` and `secret_key`** should have the same value (for compatibility)
4. **Both `webhook_secret` and `secret`** should have the same value (for compatibility)
5. **All Stripe secrets are in ONE consolidated secret** - `cosine-production-stripe-production` contains both the secret key and webhook secret

---

## Verification

After setting all keys:

1. **Frontend:** Check browser console - should see Stripe loaded (no error)
2. **Backend:** Check CloudWatch logs - should see "✅ Successfully retrieved Stripe secret key"
3. **Webhook:** Test with Stripe CLI or make a test payment

