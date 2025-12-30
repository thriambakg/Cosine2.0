# Test Payloads for Billing Lambdas

Use these payloads to manually trigger the scheduled events for both billing lambdas to generate the S3 summary files.

## ⚠️ Execution Order

**IMPORTANT:** Run the payment lambda FIRST, then the spending lambda. This ensures earnings data is available when the spending lambda updates the monthly summary.

1. **First:** Run payment lambda to calculate earnings
2. **Second:** Run spending lambda to generate spending summary (it will include earnings data)

---

## 1. Payment Lambda - Monthly Earnings Calculation

**Lambda Function:** `cosine-production-billing-payment-production`

**EventBridge Scheduler Payload (JSON):**
```json
{
  "source": "aws.events",
  "detail-type": "Scheduled Event",
  "action": "calculate_monthly_earnings"
}
```

**AWS CLI Command:**
```bash
aws lambda invoke \
  --function-name cosine-production-billing-payment-production \
  --payload '{"source":"aws.events","detail-type":"Scheduled Event","action":"calculate_monthly_earnings"}' \
  --region us-east-1 \
  response.json && cat response.json
```

**What it does:**
- Reads all payment CSVs from previous month (`earnings/YYYY/MM/`)
- Calculates total earnings and payment count
- Updates `earnings_summary.csv` with monthly totals

**Expected Output:**
```json
{
  "statusCode": 200,
  "body": "{\"success\":true,\"month\":\"2025-12\",\"earnings\":{\"month\":\"2025-12\",\"total_earnings\":0.0,\"payment_count\":0,\"currency\":\"USD\"},\"message\":\"Monthly earnings calculated for 2025-12\"}"
}
```

---

## 2. Spending Lambda - Monthly Summary Generation

**Lambda Function:** `cosine-production-billing-spending-production`

**EventBridge Scheduler Payload (JSON):**
```json
{
  "source": "aws.events",
  "detail-type": "Scheduled Event",
  "action": "generate_monthly_summary"
}
```

**AWS CLI Command:**
```bash
aws lambda invoke \
  --function-name cosine-production-billing-spending-production \
  --payload '{"source":"aws.events","detail-type":"Scheduled Event","action":"generate_monthly_summary"}' \
  --region us-east-1 \
  response.json && cat response.json
```

**What it does:**
- Calculates previous month's spending from AWS Cost Explorer
- Creates detailed monthly CSV: `spendings/YYYY/MM.csv`
- Updates `monthly_summary.csv` with spending and earnings data

**Expected Output:**
```json
{
  "statusCode": 200,
  "body": "{\"success\":true,\"month\":\"2025-12\",\"period\":{\"start\":\"2025-12-01\",\"end\":\"2025-12-31\"},\"totals\":{\"blended_cost\":123.45,\"unblended_cost\":123.45,\"usage_quantity\":0.0},\"stored\":{\"monthly_csv\":\"spendings/2025/12.csv\",\"summary\":\"monthly_summary.csv\"},\"message\":\"Monthly summary generated for 2025-12\"}"
}
```

---

## Expected S3 Files After Execution

After running both lambdas, you should see:

1. **`monthly_summary.csv`** - Combined spending and earnings summary (root level)
2. **`earnings_summary.csv`** - Earnings-only summary (root level)
3. **`spendings/YYYY/MM.csv`** - Detailed spending breakdown for the month

## Verification

**Check S3 bucket contents:**
```bash
aws s3 ls s3://cosine-spending-production/ --recursive
```

**View monthly summary:**
```bash
aws s3 cp s3://cosine-spending-production/monthly_summary.csv - | cat
```

**View earnings summary:**
```bash
aws s3 cp s3://cosine-spending-production/earnings_summary.csv - | cat
```

**View detailed spending for a month:**
```bash
aws s3 cp s3://cosine-spending-production/spendings/2025/12.csv - | cat
```

---

## Troubleshooting

If you see "No historical data in S3" warnings in the frontend:
- This means `monthly_summary.csv` doesn't exist yet
- Run both lambdas using the commands above to generate the files
- The frontend will then display the data from S3

If earnings show as $0.00:
- Check if payment CSVs exist in `earnings/YYYY/MM/` folder
- Run the payment lambda first to calculate totals
- Then run the spending lambda to include earnings in the summary

