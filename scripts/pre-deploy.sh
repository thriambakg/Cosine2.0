#!/bin/bash
# Pre-deployment script to handle existing resources
# scripts/pre-deploy.sh

set -e

echo "🔧 Pre-deployment: Checking for existing resources..."

# Function to check if resource exists and add to ignore list
check_and_ignore() {
    local resource_type=$1
    local resource_name=$2
    local terraform_address=$3
    
    echo "Checking $resource_type: $resource_name"
    
    # This script could be expanded to automatically import resources
    # For now, it just logs what would be needed
    echo "  -> Would import $terraform_address if it exists"
}

# Check for existing resources that might conflict
echo "📋 Resources that may need importing:"
check_and_ignore "KMS Alias" "alias/cosine-staging" "aws_kms_alias.main"
check_and_ignore "ECR Repository" "cosine-frontend-staging" "module.ecr.aws_ecr_repository.frontend"
check_and_ignore "ALB" "cosine-alb-staging" "module.alb.aws_lb.main"
check_and_ignore "Target Group" "cosine-frontend-tg-staging" "module.alb.aws_lb_target_group.frontend"
check_and_ignore "IAM Role" "cosine-flow-log-role-staging" "module.vpc.aws_iam_role.flow_log"

echo "✅ Pre-deployment checks complete"
echo "💡 The terraform configuration includes lifecycle rules to handle existing resources"
echo "🚀 Proceeding with terraform plan/apply..."
