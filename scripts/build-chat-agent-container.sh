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
    AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    if [ -z "$AWS_ACCOUNT_ID" ]; then
        log_error "Failed to get AWS Account ID"
        exit 1
    fi
    log_success "AWS Account ID: $AWS_ACCOUNT_ID"
}

# Set ECR variables
set_ecr_variables() {
    ECR_REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
    ECR_REPOSITORY="${PROJECT_NAME}-chat-agent-${ENVIRONMENT}"
    ECR_IMAGE_URI="${ECR_REGISTRY}/${ECR_REPOSITORY}:latest"
    
    log_info "ECR Configuration:"
    log_info "  Registry: $ECR_REGISTRY"
    log_info "  Repository: $ECR_REPOSITORY"
    log_info "  Image URI: $ECR_IMAGE_URI"
}

# Login to ECR
login_to_ecr() {
    log_info "Logging in to ECR..."
    aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_REGISTRY
    if [ $? -eq 0 ]; then
        log_success "Successfully logged in to ECR"
    else
        log_error "Failed to login to ECR"
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
    docker tag $ECR_REPOSITORY:latest $ECR_IMAGE_URI
    if [ $? -eq 0 ]; then
        log_success "Docker image tagged successfully"
    else
        log_error "Failed to tag Docker image"
        exit 1
    fi
}

# Push image to ECR
push_docker_image() {
    log_info "Pushing Docker image to ECR..."
    docker push $ECR_IMAGE_URI
    if [ $? -eq 0 ]; then
        log_success "Docker image pushed successfully to ECR"
    else
        log_error "Failed to push Docker image to ECR"
        exit 1
    fi
}

# Verify image exists in ECR
verify_ecr_image() {
    log_info "Verifying image exists in ECR..."
    aws ecr describe-images --repository-name $ECR_REPOSITORY --region $AWS_REGION --image-ids imageTag=latest > /dev/null
    if [ $? -eq 0 ]; then
        log_success "Image verified in ECR repository"
    else
        log_error "Image not found in ECR repository"
        exit 1
    fi
}

# Main execution
main() {
    log_info "Starting chat agent container build process..."
    log_info "Environment: $ENVIRONMENT"
    log_info "AWS Region: $AWS_REGION"
    
    get_aws_account_id
    set_ecr_variables
    login_to_ecr
    build_docker_image
    tag_docker_image
    push_docker_image
    verify_ecr_image
    
    log_success "Chat agent container build and push completed successfully!"
    log_info "Image URI: $ECR_IMAGE_URI"
}

# Run main function
main "$@"
