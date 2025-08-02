#!/bin/bash
# Handle existing resources during terraform deployment
# This script is designed to be run by GitHub Actions

set -e

echo "🔧 Handling existing AWS resources for Terraform..."

# Function to safely import a resource if it exists
safe_import() {
    local terraform_address=$1
    local aws_id=$2
    local resource_name=$3
    
    echo "Checking if $resource_name needs importing..."
    
    # Try to import, but don't fail if resource doesn't exist or is already imported
    if terraform import "$terraform_address" "$aws_id" 2>/dev/null; then
        echo "✅ Successfully imported $resource_name"
    elif [ $? -eq 1 ]; then
        echo "ℹ️  $resource_name: Already in state or doesn't exist (continuing)"
    else
        echo "⚠️  $resource_name: Import failed (continuing anyway)"
    fi
}

echo "🚀 Starting selective resource imports..."

# Import existing resources that may cause conflicts
safe_import "aws_kms_alias.main" "alias/cosine-staging" "KMS Alias"
safe_import "module.ecr.aws_ecr_repository.frontend" "cosine-frontend-staging" "ECR Repository" 
safe_import "module.vpc.aws_iam_role.flow_log" "cosine-flow-log-role-staging" "Flow Log IAM Role"

# Note: ALB and target group imports require specific ARNs which may change
# The lifecycle rules we added should handle these gracefully

echo "✅ Resource import phase completed"
echo "🎯 Terraform apply should now proceed without conflicts"
