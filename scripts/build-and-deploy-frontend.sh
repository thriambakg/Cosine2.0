#!/bin/bash
# Frontend Build and Deploy Script
# Builds and pushes frontend container to ECR

set -e  # Exit on any error

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROJECT_NAME="cosine"
AWS_REGION="us-east-1"
FRONTEND_DIR="frontend/app"

echo -e "${BLUE}🚀 Cosine Frontend Build and Deploy Script${NC}"
echo "=================================================="

# Check if we're in the right directory
if [ ! -f "terraform/main.tf" ]; then
    echo -e "${RED}❌ Error: Run this script from the Cosine2.0 project root directory${NC}"
    exit 1
fi

# Check if frontend directory exists
if [ ! -d "$FRONTEND_DIR" ]; then
    echo -e "${RED}❌ Error: Frontend directory not found: $FRONTEND_DIR${NC}"
    exit 1
fi

# Check if Dockerfile exists
if [ ! -f "$FRONTEND_DIR/Dockerfile" ]; then
    echo -e "${RED}❌ Error: Dockerfile not found in $FRONTEND_DIR${NC}"
    exit 1
fi

# Get environment (default to staging)
ENVIRONMENT=${1:-staging}
echo -e "${BLUE}📋 Environment: $ENVIRONMENT${NC}"

# Change to terraform directory to get outputs
cd terraform

# Check if terraform is initialized
if [ ! -d ".terraform" ]; then
    echo -e "${YELLOW}⚠️  Terraform not initialized. Running terraform init...${NC}"
    terraform init
fi

# Get ECR repository URL from terraform output
echo -e "${BLUE}🔍 Getting ECR repository URL from terraform...${NC}"
ECR_REPOSITORY_URL=$(terraform output -raw ecr_repository_url 2>/dev/null || echo "")

if [ -z "$ECR_REPOSITORY_URL" ]; then
    echo -e "${RED}❌ Error: Could not get ECR repository URL from terraform output${NC}"
    echo -e "${YELLOW}💡 Make sure you've run 'terraform apply' first${NC}"
    exit 1
fi

echo -e "${GREEN}✅ ECR Repository: $ECR_REPOSITORY_URL${NC}"

# Extract ECR registry URL (before the repository name)
ECR_REGISTRY=$(echo $ECR_REPOSITORY_URL | cut -d'/' -f1)
echo -e "${BLUE}📦 ECR Registry: $ECR_REGISTRY${NC}"

# Change to frontend directory
cd "../$FRONTEND_DIR"

# Check if package.json exists
if [ ! -f "package.json" ]; then
    echo -e "${RED}❌ Error: package.json not found in $FRONTEND_DIR${NC}"
    exit 1
fi

echo -e "${BLUE}🔨 Building Docker image...${NC}"

# Build Docker image
docker build -t cosine-frontend:latest .

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Error: Docker build failed${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Docker image built successfully${NC}"

# Tag image for ECR
echo -e "${BLUE}🏷️  Tagging image for ECR...${NC}"
docker tag cosine-frontend:latest $ECR_REPOSITORY_URL:latest

# Login to ECR
echo -e "${BLUE}🔑 Logging into ECR...${NC}"
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_REGISTRY

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Error: ECR login failed${NC}"
    echo -e "${YELLOW}💡 Make sure you have AWS CLI configured and proper permissions${NC}"
    exit 1
fi

echo -e "${GREEN}✅ ECR login successful${NC}"

# Push image to ECR
echo -e "${BLUE}📤 Pushing image to ECR...${NC}"
docker push $ECR_REPOSITORY_URL:latest

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Error: Docker push failed${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Image pushed successfully to ECR${NC}"

# Get the website URL
cd ../../terraform
WEBSITE_URL=$(terraform output -raw frontend_url 2>/dev/null || echo "")

echo ""
echo "=================================================="
echo -e "${GREEN}🎉 DEPLOYMENT COMPLETE!${NC}"
echo "=================================================="
echo -e "${BLUE}📦 Docker Image:${NC} $ECR_REPOSITORY_URL:latest"
if [ ! -z "$WEBSITE_URL" ]; then
    echo -e "${BLUE}🌐 Website URL:${NC} $WEBSITE_URL"
else
    echo -e "${YELLOW}🌐 Get your website URL with:${NC} terraform output frontend_url"
fi
echo ""
echo -e "${YELLOW}⏳ Note: ECS service may take 2-3 minutes to pull and start the new container${NC}"
echo -e "${BLUE}📊 Monitor deployment:${NC} AWS Console → ECS → Services → cosine-frontend-$ENVIRONMENT"
echo ""
echo -e "${GREEN}🔧 Next Steps:${NC}"
echo "1. Visit your website URL to test"
echo "2. Check ECS service health in AWS Console"
echo "3. Review CloudWatch logs if needed"
echo "4. Update Cognito callback URLs if authentication fails"
echo ""
