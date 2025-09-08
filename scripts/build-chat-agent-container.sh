#!/bin/bash

# Build Chat Agent Container Script
# This script builds and pushes the chat agent container to ECR

set -e

# Configuration
PROJECT_NAME="cosine"
ENVIRONMENT="${ENVIRONMENT:-production}"
AWS_REGION="${AWS_REGION:-us-east-1}"
CHAT_AGENT_DIR="backend_app/src/Chat"

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
    ECR_REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
    ECR_REPOSITORY="${PROJECT_NAME}-chat-agent-${ENVIRONMENT}"
    
    # Use timestamp-based tag to avoid conflicts with immutable repositories
    TIMESTAMP=$(date +%Y%m%d-%H%M%S)
    IMAGE_TAG="latest-${TIMESTAMP}"
    ECR_IMAGE_URI="${ECR_REGISTRY}/${ECR_REPOSITORY}:${IMAGE_TAG}"
    ECR_IMAGE_URI_LATEST="${ECR_REGISTRY}/${ECR_REPOSITORY}:latest"
    
    log_info "ECR Configuration:"
    log_info "  Registry: $ECR_REGISTRY"
    log_info "  Repository: $ECR_REPOSITORY"
    log_info "  Image Tag: $IMAGE_TAG"
    log_info "  Image URI: $ECR_IMAGE_URI"
    log_info "  Latest URI: $ECR_IMAGE_URI_LATEST"
}

# Login to ECR
login_to_ecr() {
    log_info "Logging in to ECR..."
    log_info "ECR Registry: $ECR_REGISTRY"
    log_info "AWS Region: $AWS_REGION"
    
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
    
    # Build the image
    docker build -t $ECR_REPOSITORY:latest $CHAT_AGENT_DIR/
    if [ $? -eq 0 ]; then
        log_success "Docker image built successfully"
    else
        log_error "Failed to build Docker image"
        exit 1
    fi
}

# Tag image for ECR
tag_docker_image() {
    log_info "Tagging Docker image for ECR..."
    
    # Tag with timestamp
    docker tag $ECR_REPOSITORY:latest $ECR_IMAGE_URI
    if [ $? -eq 0 ]; then
        log_success "Docker image tagged with timestamp: $IMAGE_TAG"
    else
        log_error "Failed to tag Docker image with timestamp"
        exit 1
    fi
    
    # Also tag as latest (will work if repository is mutable)
    docker tag $ECR_REPOSITORY:latest $ECR_IMAGE_URI_LATEST
    if [ $? -eq 0 ]; then
        log_success "Docker image tagged as latest"
    else
        log_warning "Failed to tag Docker image as latest (repository may be immutable)"
    fi
}

# Push image to ECR
push_docker_image() {
    log_info "Pushing Docker image to ECR..."
    
    # Push timestamped tag (should always work)
    docker push $ECR_IMAGE_URI
    if [ $? -eq 0 ]; then
        log_success "Docker image pushed successfully with timestamp: $IMAGE_TAG"
    else
        log_error "Failed to push Docker image with timestamp"
        exit 1
    fi
    
    # Try to push latest tag (will work if repository is mutable)
    docker push $ECR_IMAGE_URI_LATEST
    if [ $? -eq 0 ]; then
        log_success "Docker image pushed successfully as latest"
    else
        log_warning "Failed to push Docker image as latest (repository may be immutable)"
        log_info "Using timestamped tag: $ECR_IMAGE_URI"
    fi
}

# Verify image exists in ECR
verify_ecr_image() {
    log_info "Verifying image exists in ECR..."
    
    # Check timestamped tag first
    aws ecr describe-images --repository-name $ECR_REPOSITORY --region $AWS_REGION --image-ids imageTag=$IMAGE_TAG > /dev/null
    if [ $? -eq 0 ]; then
        log_success "Timestamped image verified in ECR repository: $IMAGE_TAG"
    else
        log_error "Timestamped image not found in ECR repository: $IMAGE_TAG"
        exit 1
    fi
    
    # Check latest tag if it exists
    aws ecr describe-images --repository-name $ECR_REPOSITORY --region $AWS_REGION --image-ids imageTag=latest > /dev/null 2>&1
    if [ $? -eq 0 ]; then
        log_success "Latest image also verified in ECR repository"
    else
        log_info "Latest tag not found (repository may be immutable)"
    fi
}

# Main execution
main() {
    log_info "Starting chat agent container build process..."
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
    
    log_success "Prerequisites check passed"
    
    # Execute build steps
    log_info "Step 1: Getting AWS Account ID..."
    get_aws_account_id
    
    log_info "Step 2: Setting ECR variables..."
    set_ecr_variables
    
    log_info "Step 3: Logging in to ECR..."
    login_to_ecr
    
    log_info "Step 4: Building Docker image..."
    build_docker_image
    
    log_info "Step 5: Tagging Docker image..."
    tag_docker_image
    
    log_info "Step 6: Pushing Docker image..."
    push_docker_image
    
    log_info "Step 7: Verifying ECR image..."
    verify_ecr_image
    
    log_success "Chat agent container build and push completed successfully!"
    log_info "Primary Image URI: $ECR_IMAGE_URI"
    log_info "Latest Image URI: $ECR_IMAGE_URI_LATEST"
}

# Run main function
main "$@"
