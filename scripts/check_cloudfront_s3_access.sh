#!/bin/bash
# Script to diagnose CloudFront + S3 403 errors

set -e

echo "=== CloudFront + S3 Access Diagnostic ==="
echo ""

# Get environment from argument or default to production
ENVIRONMENT=${1:-production}
PROJECT_NAME=${2:-cosine}

BUCKET_NAME="${PROJECT_NAME}-static-hosting-${ENVIRONMENT}"

echo "Checking S3 bucket: ${BUCKET_NAME}"
echo ""

# Check if bucket exists
echo "1. Checking if S3 bucket exists..."
if aws s3 ls "s3://${BUCKET_NAME}" 2>&1 | grep -q "NoSuchBucket"; then
    echo "   ❌ Bucket does not exist!"
    exit 1
else
    echo "   ✅ Bucket exists"
fi

# Check bucket policy
echo ""
echo "2. Checking S3 bucket policy..."
BUCKET_POLICY=$(aws s3api get-bucket-policy --bucket "${BUCKET_NAME}" 2>&1 || echo "NO_POLICY")
if [[ "$BUCKET_POLICY" == *"NoSuchBucketPolicy"* ]] || [[ "$BUCKET_POLICY" == *"NO_POLICY"* ]]; then
    echo "   ❌ No bucket policy found! This is likely the issue."
    echo "   The bucket policy should allow CloudFront to access the bucket."
else
    echo "   ✅ Bucket policy exists"
    echo "$BUCKET_POLICY" | jq -r '.Policy' | jq '.'
fi

# Check public access block settings
echo ""
echo "3. Checking S3 bucket public access block settings..."
PUBLIC_ACCESS=$(aws s3api get-public-access-block --bucket "${BUCKET_NAME}" 2>&1 || echo "NO_BLOCK")
if [[ "$PUBLIC_ACCESS" == *"NoSuchPublicAccessBlockConfiguration"* ]] || [[ "$PUBLIC_ACCESS" == *"NO_BLOCK"* ]]; then
    echo "   ⚠️  No public access block configuration found"
else
    echo "$PUBLIC_ACCESS" | jq '.'
    BLOCK_PUBLIC_POLICY=$(echo "$PUBLIC_ACCESS" | jq -r '.PublicAccessBlockConfiguration.BlockPublicPolicy // "unknown"')
    RESTRICT_PUBLIC_BUCKETS=$(echo "$PUBLIC_ACCESS" | jq -r '.PublicAccessBlockConfiguration.RestrictPublicBuckets // "unknown"')
    
    if [[ "$BLOCK_PUBLIC_POLICY" == "true" ]] || [[ "$RESTRICT_PUBLIC_BUCKETS" == "true" ]]; then
        echo "   ⚠️  Public access block may be preventing CloudFront access"
        echo "   For OAC, block_public_policy and restrict_public_buckets should be false"
    else
        echo "   ✅ Public access block settings are correct for OAC"
    fi
fi

# Check if files exist in bucket
echo ""
echo "4. Checking if files exist in S3 bucket..."
FILE_COUNT=$(aws s3 ls "s3://${BUCKET_NAME}/" --recursive 2>&1 | wc -l)
if [ "$FILE_COUNT" -eq 0 ]; then
    echo "   ❌ No files found in bucket! Files need to be uploaded."
else
    echo "   ✅ Found ${FILE_COUNT} files in bucket"
    echo "   First few files:"
    aws s3 ls "s3://${BUCKET_NAME}/" --recursive | head -5
fi

# Check CloudFront distributions
echo ""
echo "5. Checking CloudFront distributions..."
DISTRIBUTIONS=$(aws cloudfront list-distributions --query "DistributionList.Items[?contains(Origins.Items[0].DomainName, '${BUCKET_NAME}')].{Id:Id,Status:Status,DomainName:DomainName,ARN:ARN}" --output json 2>&1 || echo "[]")
if [[ "$DISTRIBUTIONS" == "[]" ]] || [[ -z "$DISTRIBUTIONS" ]]; then
    echo "   ⚠️  No CloudFront distribution found for this bucket"
else
    echo "   ✅ Found CloudFront distribution(s):"
    echo "$DISTRIBUTIONS" | jq '.'
    
    DIST_ID=$(echo "$DISTRIBUTIONS" | jq -r '.[0].Id // empty')
    if [ -n "$DIST_ID" ]; then
        echo ""
        echo "   Checking distribution configuration..."
        DIST_CONFIG=$(aws cloudfront get-distribution --id "$DIST_ID" 2>&1)
        OAC_ID=$(echo "$DIST_CONFIG" | jq -r '.Distribution.DistributionConfig.Origins.Items[0].OriginAccessControlId // "none"')
        if [[ "$OAC_ID" == "none" ]] || [[ -z "$OAC_ID" ]]; then
            echo "   ❌ No Origin Access Control (OAC) configured!"
        else
            echo "   ✅ Origin Access Control configured: ${OAC_ID}"
        fi
    fi
fi

echo ""
echo "=== Diagnostic Complete ==="
echo ""
echo "Common fixes for 403 errors:"
echo "1. Ensure bucket policy allows CloudFront service principal"
echo "2. Ensure public access block allows bucket policy (block_public_policy = false)"
echo "3. Ensure CloudFront distribution has OAC configured"
echo "4. Ensure files are uploaded to S3 bucket"
echo "5. Wait for CloudFront distribution to deploy (can take 15-30 minutes)"

