#!/bin/bash

# Example: How to integrate runtime configuration generation with your existing pipeline
# This shows the steps you can add to your deploy-frontend.yml workflow

echo "🔧 Generating runtime configuration from Terraform outputs..."

# Get API Gateway URL from Terraform (your existing step)
API_GATEWAY_URL=$(terraform output -raw api_gateway_url)
AWS_REGION=$(terraform output -raw aws_region)
ENVIRONMENT=$(terraform output -raw environment)

# Get Cognito configuration (your existing step)
COGNITO_USER_POOL_ID=$(terraform output -raw cognito_user_pool_id)
COGNITO_CLIENT_ID=$(terraform output -raw cognito_client_id)
COGNITO_DOMAIN=$(terraform output -raw cognito_domain)

# Generate runtime configuration
node scripts/generate-config.js \
  --api-gateway-url "$API_GATEWAY_URL" \
  --aws-region "$AWS_REGION" \
  --environment "$ENVIRONMENT" \
  --cognito-user-pool-id "$COGNITO_USER_POOL_ID" \
  --cognito-client-id "$COGNITO_CLIENT_ID" \
  --cognito-domain "$COGNITO_DOMAIN" \
  --redirect-sign-in "https://your-domain.com/auth/callback" \
  --redirect-sign-out "https://your-domain.com" \
  --output "public/config.js"

echo "✅ Runtime configuration generated successfully"
echo "🌐 API Gateway URL: $API_GATEWAY_URL"
echo "🏗️  Environment: $ENVIRONMENT"

# Now build your React app (the config.js will be included in the build)
npm run build
