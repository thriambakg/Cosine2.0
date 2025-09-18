#!/bin/bash

# Deploy Chat Agent Container Script
# This script builds, pushes, and deploys the chat agent container with versioned tags

set -e

# Check if running in CI mode (build and push only)
CI_MODE=${CI_MODE:-false}

# Configuration
PROJECT_NAME="cosine"
ENVIRONMENT="${ENVIRONMENT:-production}"
AWS_REGION="${AWS_REGION:-us-east-1}"
CHAT_AGENT_DIR="backend_app/src/Chat"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Get version from git or use timestamp
get_version() {
    if git rev-parse --git-dir > /dev/null 2>&1; then
        # Use git commit hash for versioning
        VERSION="v1.0.0-$(git rev-parse --short HEAD)"
    else
        # Fallback to timestamp
        TIMESTAMP=$(date +%Y%m%d-%H%M%S)
        VERSION="v1.0.0-$TIMESTAMP"
    fi
    echo "$VERSION"  # Only output the version to stdout
}

# Get AWS Account ID
get_aws_account_id() {
    log_info "Getting AWS Account ID..."
    AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text 2>/dev/null)
    if [ $? -ne 0 ] || [ -z "$AWS_ACCOUNT_ID" ]; then
        log_error "Failed to get AWS Account ID. Please check AWS credentials."
        log_error "Run 'aws configure' or set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables."
        exit 1
    fi
    log_success "AWS Account ID: $AWS_ACCOUNT_ID"
}

# Set ECR variables
set_ecr_variables() {
    # Get version (function is now silent)
    VERSION=$(get_version)
    ECR_REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
    ECR_REPOSITORY="${PROJECT_NAME}-chat-agent-${ENVIRONMENT}"
    
    # Use versioned tag
    IMAGE_TAG="$VERSION"
    ECR_IMAGE_URI="${ECR_REGISTRY}/${ECR_REPOSITORY}:${IMAGE_TAG}"
    
    # Also create a latest tag for convenience
    ECR_IMAGE_URI_LATEST="${ECR_REGISTRY}/${ECR_REPOSITORY}:latest"
    
    # Log the version source
    if git rev-parse --git-dir > /dev/null 2>&1; then
        log_info "Using git-based version: $VERSION"
    else
        log_warning "Not in a git repository, using timestamp version: $VERSION"
    fi
    
    log_info "ECR Configuration:"
    log_info "  Registry: $ECR_REGISTRY"
    log_info "  Repository: $ECR_REPOSITORY"
    log_info "  Version: $VERSION"
    log_info "  Image Tag: $IMAGE_TAG"
    log_info "  Image URI: $ECR_IMAGE_URI"
    log_info "  Latest URI: $ECR_IMAGE_URI_LATEST"
}

# Login to ECR
login_to_ecr() {
    log_info "Logging in to ECR..."
    
    # Get ECR login password
    ECR_PASSWORD=$(aws ecr get-login-password --region $AWS_REGION 2>/dev/null)
    if [ $? -ne 0 ] || [ -z "$ECR_PASSWORD" ]; then
        log_error "Failed to get ECR login password. Please check AWS credentials and region."
        exit 1
    fi
    
    # Login to ECR
    echo "$ECR_PASSWORD" | docker login --username AWS --password-stdin $ECR_REGISTRY 2>/dev/null
    if [ $? -eq 0 ]; then
        log_success "Successfully logged in to ECR"
    else
        log_error "Failed to login to ECR. Please check Docker is running and ECR repository exists."
        exit 1
    fi
}

# Build Docker image
build_docker_image() {
    log_info "Building Docker image for chat agent..."
    
    cd "$PROJECT_ROOT"
    
    # Check if Dockerfile exists
    if [ ! -f "$CHAT_AGENT_DIR/Dockerfile" ]; then
        log_error "Dockerfile not found at $CHAT_AGENT_DIR/Dockerfile"
        exit 1
    fi
    
    # Check if requirements.txt exists
    if [ ! -f "$CHAT_AGENT_DIR/requirements.txt" ]; then
        log_error "requirements.txt not found at $CHAT_AGENT_DIR/requirements.txt"
        exit 1
    fi
    
    # Build the image with local tag first
    docker build -t $ECR_REPOSITORY:$IMAGE_TAG $CHAT_AGENT_DIR/
    if [ $? -eq 0 ]; then
        log_success "Docker image built successfully with local tag: $ECR_REPOSITORY:$IMAGE_TAG"
    else
        log_error "Failed to build Docker image"
        exit 1
    fi
    
    # Tag for ECR push
    docker tag $ECR_REPOSITORY:$IMAGE_TAG $ECR_IMAGE_URI
    if [ $? -eq 0 ]; then
        log_success "Docker image tagged for ECR: $ECR_IMAGE_URI"
    else
        log_error "Failed to tag Docker image for ECR"
        exit 1
    fi
    
    # Also tag as latest for ECR
    docker tag $ECR_REPOSITORY:$IMAGE_TAG $ECR_IMAGE_URI_LATEST
    if [ $? -eq 0 ]; then
        log_success "Docker image also tagged as latest for ECR: $ECR_IMAGE_URI_LATEST"
    else
        log_error "Failed to tag Docker image as latest for ECR"
        exit 1
    fi
}

# Push image to ECR
push_docker_image() {
    log_info "Pushing Docker image to ECR..."
    
    # Push versioned tag
    docker push $ECR_IMAGE_URI
    if [ $? -eq 0 ]; then
        log_success "Docker image pushed successfully with version: $IMAGE_TAG"
    else
        log_error "Failed to push Docker image with version"
        exit 1
    fi
    
    # Push latest tag
    log_info "Pushing latest tag..."
    docker push $ECR_IMAGE_URI_LATEST
    if [ $? -eq 0 ]; then
        log_success "Docker image pushed successfully as latest"
        
        # Verify the latest tag points to the correct image
        log_info "Verifying latest tag points to correct image..."
        LATEST_DIGEST=$(docker inspect --format='{{index .RepoDigests 0}}' $ECR_IMAGE_URI_LATEST 2>/dev/null || echo "Unable to get digest")
        log_info "Latest tag digest: $LATEST_DIGEST"
    else
        log_error "Failed to push Docker image as latest - this may cause Lambda to use old image!"
        exit 1
    fi
}

# Verify image exists in ECR
verify_ecr_image() {
    log_info "Verifying image exists in ECR..."
    
    # Check versioned tag
    aws ecr describe-images --repository-name $ECR_REPOSITORY --region $AWS_REGION --image-ids imageTag=$IMAGE_TAG > /dev/null
    if [ $? -eq 0 ]; then
        log_success "Versioned image verified in ECR repository: $IMAGE_TAG"
    else
        log_error "Versioned image not found in ECR repository: $IMAGE_TAG"
        exit 1
    fi
}

# Deploy with Terraform
deploy_with_terraform() {
    log_info "Deploying Lambda function with Terraform..."
    
    cd "$PROJECT_ROOT/terraform"
    
    # Check if terraform is available
    if ! command -v terraform &> /dev/null; then
        log_error "Terraform is not installed or not in PATH"
        exit 1
    fi
    
    # Set the image URI variable for Terraform (full URI with versioned tag)
    FULL_IMAGE_URI="${ECR_REGISTRY}/${ECR_REPOSITORY}:${IMAGE_TAG}"
    export TF_VAR_chat_agent_image_uri="$FULL_IMAGE_URI"
    export TF_VAR_chat_agent_image_tag=""  # Clear tag since we're using full URI
    export TF_VAR_chat_agent_deployment_trigger="$IMAGE_TAG"  # Force Lambda redeployment
    
    log_info "Using full image URI: $FULL_IMAGE_URI"
    log_info "Deployment trigger: $IMAGE_TAG"
    
    log_info "Using image tag: $IMAGE_TAG"
    
    # Run terraform plan first
    log_info "Running terraform plan..."
    terraform plan -var-file="environments/production.auto.tfvars"
    
    if [ $? -ne 0 ]; then
        log_error "Terraform plan failed"
        exit 1
    fi
    
    # Ask for confirmation
    echo
    log_warning "Do you want to apply these changes? (y/N)"
    read -r response
    if [[ ! "$response" =~ ^[Yy]$ ]]; then
        log_info "Deployment cancelled by user"
        exit 0
    fi
    
    # Apply terraform
    log_info "Running terraform apply..."
    terraform apply -var-file="environments/production.auto.tfvars"
    
    if [ $? -eq 0 ]; then
        log_success "Terraform deployment completed successfully!"
    else
        log_error "Terraform deployment failed"
        exit 1
    fi
}

# Main execution
main() {
    log_info "Starting chat agent deployment process..."
    log_info "Environment: $ENVIRONMENT"
    log_info "AWS Region: $AWS_REGION"
    log_info "Project Name: $PROJECT_NAME"
    log_info "Chat Agent Directory: $CHAT_AGENT_DIR"
    
    # Check prerequisites
    log_info "Checking prerequisites..."
    
    # Check if AWS CLI is available
    if ! command -v aws &> /dev/null; then
        log_error "AWS CLI is not installed or not in PATH"
        exit 1
    fi
    
    # Check if Docker is available
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed or not in PATH"
        exit 1
    fi
    
    # Check if Docker is running
    if ! docker info &> /dev/null; then
        log_error "Docker is not running. Please start Docker daemon."
        exit 1
    fi
    
    # Disable Docker Buildx to use legacy builder (more reliable in CI)
    log_info "Configuring Docker to use legacy builder..."
    export DOCKER_BUILDKIT=0
    export COMPOSE_DOCKER_CLI_BUILD=0
    
    log_success "Prerequisites check passed"
    
    # Execute deployment steps
    log_info "Step 1: Getting AWS Account ID..."
    get_aws_account_id
    
    log_info "Step 2: Setting ECR variables..."
    set_ecr_variables
    
    log_info "Step 3: Logging in to ECR..."
    login_to_ecr
    
    log_info "Step 4: Building Docker image..."
    build_docker_image
    
    log_info "Step 5: Pushing Docker image..."
    push_docker_image
    
    log_info "Step 6: Verifying ECR image..."
    verify_ecr_image
    
    if [ "$CI_MODE" = "true" ]; then
        log_info "Running in CI mode - skipping Terraform deployment"
        log_success "Chat agent container build and push completed successfully!"
        log_info "Built Image URI: $ECR_IMAGE_URI"
        log_info "Version: $IMAGE_TAG"
    else
        log_info "Step 7: Deploying with Terraform..."
        deploy_with_terraform
        
        log_success "Chat agent deployment completed successfully!"
        log_info "Deployed Image URI: $ECR_IMAGE_URI"
        log_info "Version: $IMAGE_TAG"
    fi
}

# Run main function
main "$@"
