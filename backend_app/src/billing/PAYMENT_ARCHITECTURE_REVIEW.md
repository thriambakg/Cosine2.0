# Payment Architecture Review & Recommendations

## Current Implementation Analysis

### ✅ What's Working Well

1. **Secrets Management**
   - ✅ Using AWS Secrets Manager (not hardcoded)
   - ✅ Secret keys stored securely
   - ✅ Webhook secret stored separately
   - ✅ Proper IAM permissions configured

2. **Payment Flow**
   - ✅ Using Payment Intents (good for in-app payments)
   - ✅ Frontend uses Stripe.js Elements
   - ✅ Backend creates payment intent, frontend confirms
   - ✅ Proper error handling

3. **Webhook Security**
   - ✅ Webhook signature verification implemented
   - ✅ Using `stripe.Webhook.construct_event()` for verification

### ⚠️ Issues & Improvements Needed

#### 1. **Webhook Event Handling** (CRITICAL)
**Current:** Only handles `payment_intent.succeeded`
**Needed:** Also handle `payment_intent.payment_failed`

**Fix Required:**
```python
# In handle_webhook_event()
if event_type == 'payment_intent.succeeded':
    # Record payment
elif event_type == 'payment_intent.payment_failed':
    # Log failed payment for monitoring
    logger.warning(f"❌ Payment failed: {payment_data['payment_intent_id']}")
```

#### 2. **API Gateway Webhook Configuration** (CRITICAL)
**Issue:** API Gateway may be parsing JSON body before Lambda receives it, which breaks webhook signature verification.

**Stripe Requirement:** Webhook endpoint must receive RAW body (not parsed JSON) for signature verification to work.

**Check Needed:**
- API Gateway must pass raw body to Lambda
- Binary media types may need to be configured
- Content handling should be PASSTHROUGH for webhook endpoint

**Solution:** Ensure API Gateway integration uses `AWS_PROXY` with raw body passthrough, or configure binary media types.

#### 3. **Idempotency** (IMPORTANT)
**Issue:** No idempotency handling for webhook events. Stripe may send the same event multiple times.

**Fix Required:**
- Store processed event IDs in DynamoDB or S3
- Check if event already processed before recording payment
- Prevents duplicate payment recording

#### 4. **Frontend Publishable Key**
**Current:** Uses `VITE_STRIPE_PUBLISHABLE_KEY` from environment
**Status:** ✅ Correctly configured in GitHub Secrets
**Action:** Ensure `STRIPE_PUBLISHABLE_KEY` secret is set in GitHub repository

#### 5. **Webhook Endpoint URL**
**Current:** Uses same endpoint as payment intent creation (`/billing-payment`)
**Recommendation:** Consider separate endpoint (`/billing-payment/webhook`) for clarity

**Current Flow:**
- POST `/billing-payment` → Creates payment intent (if no Stripe-Signature header)
- POST `/billing-payment` → Handles webhook (if Stripe-Signature header present)

**This works but could be clearer with separate endpoint.**

## ✅ Implemented Improvements

### Priority 1: Critical Fixes (COMPLETED)

1. ✅ **Added payment_failed event handling** - Now logs failed payments
2. ✅ **Added base64 body decoding** - Handles API Gateway encoding
3. ✅ **Added idempotency checking** - Uses S3 to track processed events
4. ✅ **Improved webhook body handling** - Verifies signature before parsing

### Priority 2: Enhancements (COMPLETED)

1. ✅ **Added webhook event logging** - All event types are logged
2. ✅ **Better error handling** - Clear error messages for webhook issues

### Priority 3: Nice to Have (Future)

1. **Separate webhook endpoint** (`/billing-payment/webhook`) - Current implementation works
2. **Webhook event replay** capability - Can be added later
3. **Payment analytics dashboard** - Future enhancement

## Security Checklist

- ✅ Secret keys in Secrets Manager (not hardcoded)
- ✅ Webhook signature verification
- ✅ HTTPS enforced (via API Gateway)
- ⚠️ Need to verify: API Gateway raw body passthrough
- ⚠️ Need to add: Idempotency handling
- ✅ CORS properly configured
- ✅ No secret keys exposed to frontend

## Frontend Publishable Key Setup

**GitHub Secrets:**
- Secret name: `STRIPE_PUBLISHABLE_KEY`
- Value: Your Stripe publishable key (starts with `pk_`)

**Frontend Code:**
- Already configured: `VITE_STRIPE_PUBLISHABLE_KEY`
- Location: `SupportMePage.tsx` line 28

**Deployment:**
- GitHub Actions workflow already injects: `VITE_STRIPE_PUBLISHABLE_KEY: ${{ secrets.STRIPE_PUBLISHABLE_KEY }}`
- ✅ No changes needed, just ensure the GitHub secret is set

## Next Steps

1. ✅ **Secrets created in base infrastructure** (done)
2. ⚠️ **Update secrets with real Stripe keys** (manual step in AWS Console)
3. ✅ **Payment_failed event handling** (implemented)
4. ✅ **API Gateway webhook configuration** (verified - AWS_PROXY passes raw body)
5. ✅ **Idempotency handling** (implemented using S3)
6. ⚠️ **Frontend publishable key** (needs GitHub secret `STRIPE_PUBLISHABLE_KEY` set)

## Summary

Your payment architecture is now compliant with Stripe best practices:

✅ **Secure**: Secrets in Secrets Manager, webhook verification, HTTPS
✅ **Robust**: Idempotency handling, error handling, event logging
✅ **Complete**: Handles both succeeded and failed payments
✅ **Scalable**: Lambda auto-scales, no hardcoded values

**Only remaining steps:**
1. Set `STRIPE_PUBLISHABLE_KEY` in GitHub Secrets (for frontend)
2. Update Stripe secrets in AWS Secrets Manager with real keys
3. Configure Stripe webhook endpoint in Stripe Dashboard pointing to: `https://your-api-gateway-url/production/billing-payment`

