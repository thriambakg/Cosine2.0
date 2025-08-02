#!/bin/bash
# Script to handle ALB security group conflicts
# This script should be run before terraform apply when ALB security group conflicts occur

set -e

echo "🔧 Handling ALB security group conflicts..."

# Variables
PROJECT_NAME="cosine"
ENVIRONMENT="staging"
ALB_SG_NAME="${PROJECT_NAME}-alb-${ENVIRONMENT}"
REGION="us-east-1"

echo "Looking for existing ALB and security groups..."

# Get existing ALB security groups
EXISTING_ALB_SG=$(aws ec2 describe-security-groups \
    --region $REGION \
    --filters "Name=group-name,Values=${ALB_SG_NAME}" \
    --query 'SecurityGroups[0].GroupId' \
    --output text 2>/dev/null || echo "None")

if [ "$EXISTING_ALB_SG" != "None" ] && [ "$EXISTING_ALB_SG" != "null" ]; then
    echo "Found existing security group: $EXISTING_ALB_SG"
    
    # Try to import the security group
    echo "Attempting to import existing security group..."
    if terraform import "module.alb.aws_security_group.alb" "$EXISTING_ALB_SG" 2>/dev/null; then
        echo "✅ Successfully imported security group"
    else
        echo "⚠️  Security group import failed or already imported"
    fi
else
    echo "No existing security group found with name: $ALB_SG_NAME"
fi

# Get existing ALB
EXISTING_ALB_ARN=$(aws elbv2 describe-load-balancers \
    --region $REGION \
    --names "${PROJECT_NAME}-alb-${ENVIRONMENT}" \
    --query 'LoadBalancers[0].LoadBalancerArn' \
    --output text 2>/dev/null || echo "None")

if [ "$EXISTING_ALB_ARN" != "None" ] && [ "$EXISTING_ALB_ARN" != "null" ]; then
    echo "Found existing ALB: $EXISTING_ALB_ARN"
    
    # Try to import the ALB
    echo "Attempting to import existing ALB..."
    if terraform import "module.alb.aws_lb.main" "$EXISTING_ALB_ARN" 2>/dev/null; then
        echo "✅ Successfully imported ALB"
    else
        echo "⚠️  ALB import failed or already imported"
    fi
else
    echo "No existing ALB found with name: ${PROJECT_NAME}-alb-${ENVIRONMENT}"
fi

echo "✅ ALB security group conflict handling completed"
echo "💡 You can now run 'terraform plan' and 'terraform apply'"
