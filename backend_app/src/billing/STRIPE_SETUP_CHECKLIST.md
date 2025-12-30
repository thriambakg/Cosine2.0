# Stripe Payment Setup Checklist

## ✅ Architecture Review Complete

Your payment architecture has been reviewed and updated to follow Stripe best practices. All critical improvements have been implemented.

## Current Status

### ✅ Completed
- ✅ Secrets Manager integration (backend)
- ✅ Webhook signature verification
- ✅ Payment Intents implementation
- ✅ Idempotency handling (S3-based)
- ✅ Payment failed event handling
- ✅ Base64 body decoding for webhooks
- ✅ Error handling and logging
- ✅ Frontend publishable key configuration (GitHub workflow)

### ⚠️ Manual Steps Required

## Step 1: Set Frontend Publishable Key (GitHub)

**Action:** Add GitHub Secret
- Repository: Your GitHub repo
- Secret name: `STRIPE_PUBLISHABLE_KEY`
- Value: Your Stripe publishable key (starts with `pk_live_` or `pk_test_`)

**Location:** GitHub → Settings → Secrets and variables → Actions → New repository secret

**Verification:** After next deployment, check browser console - should see Stripe loaded (no error message)

## Step 2: Update AWS Secrets Manager

**Action:** Update secrets in AWS Console with real Stripe keys

### Consolidated Secret: `cosine-production-stripe-production`
**Location:** AWS Secrets Manager → Find secret → Update secret value

**JSON Structure:**
```json
{
  "stripe_secret_key": "sk_live_...",
  "secret_key": "sk_live_...",
  "webhook_secret": "whsec_...",
  "secret": "whsec_..."
}
```

**Note:** Both the secret key and webhook secret are stored in a single consolidated secret resource.

**How to get webhook secret:**
1. Go to Stripe Dashboard → Developers → Webhooks
2. Create endpoint: `https://your-api-gateway-url/production/billing-payment`
3. Select events: `payment_intent.succeeded`, `payment_intent.payment_failed`
4. Copy the "Signing secret" (starts with `whsec_`)

## Step 3: Configure Stripe Webhook Endpoint

**In Stripe Dashboard:**
1. Go to Developers → Webhooks
2. Click "Add endpoint"
3. Endpoint URL: `https://YOUR_API_GATEWAY_URL/production/billing-payment`
   - Replace `YOUR_API_GATEWAY_URL` with your actual API Gateway URL
   - Format: `https://xxxxx.execute-api.us-east-1.amazonaws.com/production/billing-payment`
4. Select events to listen to:
   - ✅ `payment_intent.succeeded`
   - ✅ `payment_intent.payment_failed`
5. Copy the "Signing secret" and update Secret 2 above

## Step 4: Verify API Gateway URL

**Find your API Gateway URL:**
```bash
# In Cosine2.0/terraform directory
terraform output api_gateway_url
```

Or check AWS Console → API Gateway → Your API → Stages → production → Invoke URL

**Full webhook URL format:**
```
https://{api-id}.execute-api.{region}.amazonaws.com/production/billing-payment
```

## Architecture Compliance

Your implementation now follows all Stripe best practices:

✅ **Security**
- Secrets in Secrets Manager (not hardcoded)
- Webhook signature verification
- HTTPS enforced
- No secrets exposed to frontend

✅ **Reliability**
- Idempotency handling (prevents duplicate processing)
- Payment failed event handling
- Comprehensive error handling
- Event logging

✅ **Scalability**
- Lambda auto-scaling
- No hardcoded values
- Proper resource management

✅ **Best Practices**
- Payment Intents (good for in-app payments)
- Webhook verification before processing
- Raw body handling for webhooks
- Proper event handling

## Testing

### Test Payment Intent Creation
```bash
curl -X POST https://your-api-gateway-url/production/billing-payment \
  -H "Content-Type: application/json" \
  -d '{"operation":"create_payment_intent","amount":10.00,"currency":"usd"}'
```

### Test Webhook (using Stripe CLI)
```bash
stripe listen --forward-to https://your-api-gateway-url/production/billing-payment
stripe trigger payment_intent.succeeded
```

## Troubleshooting

### Frontend: "Stripe payment processing is not configured"
- ✅ Check GitHub secret `STRIPE_PUBLISHABLE_KEY` is set
- ✅ Redeploy frontend after setting secret
- ✅ Verify secret value starts with `pk_`

### Backend: "Stripe secret key not configured"
- ✅ Check AWS Secrets Manager secret is updated (not placeholders)
- ✅ Verify secret name matches: `cosine-production-stripe-production`
- ✅ Check Lambda IAM role has Secrets Manager permissions

### Webhook: "Invalid webhook signature"
- ✅ Verify webhook secret in Secrets Manager matches Stripe Dashboard
- ✅ Check webhook endpoint URL is correct
- ✅ Ensure API Gateway is passing raw body (AWS_PROXY does this automatically)

## Next Steps After Setup

1. Test a small donation ($1) to verify end-to-end flow
2. Check CloudWatch logs for webhook events
3. Verify S3 files are created (`earnings/` folder)
4. Monitor for any errors in logs

