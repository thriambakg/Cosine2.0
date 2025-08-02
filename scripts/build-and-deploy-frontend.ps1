# Frontend Build and Deploy Script (PowerShell)
# Builds and pushes frontend container to ECR

param(
    [string]$Environment = "staging"
)

# Configuration
$PROJECT_NAME = "cosine"
$AWS_REGION = "us-east-1"
$FRONTEND_DIR = "frontend/app"

# Colors for output
$Red = [System.ConsoleColor]::Red
$Green = [System.ConsoleColor]::Green
$Yellow = [System.ConsoleColor]::Yellow
$Blue = [System.ConsoleColor]::Blue

function Write-ColorOutput {
    param([string]$Message, [System.ConsoleColor]$Color = [System.ConsoleColor]::White)
    Write-Host $Message -ForegroundColor $Color
}

Write-ColorOutput "🚀 Cosine Frontend Build and Deploy Script" $Blue
Write-ColorOutput "==================================================" $Blue

# Check if we're in the right directory
if (-not (Test-Path "terraform/main.tf")) {
    Write-ColorOutput "❌ Error: Run this script from the Cosine2.0 project root directory" $Red
    exit 1
}

# Check if frontend directory exists
if (-not (Test-Path $FRONTEND_DIR)) {
    Write-ColorOutput "❌ Error: Frontend directory not found: $FRONTEND_DIR" $Red
    exit 1
}

# Check if Dockerfile exists
if (-not (Test-Path "$FRONTEND_DIR/Dockerfile")) {
    Write-ColorOutput "❌ Error: Dockerfile not found in $FRONTEND_DIR" $Red
    exit 1
}

Write-ColorOutput "📋 Environment: $Environment" $Blue

# Change to terraform directory
Set-Location terraform

# Check if terraform is initialized
if (-not (Test-Path ".terraform")) {
    Write-ColorOutput "⚠️  Terraform not initialized. Running terraform init..." $Yellow
    terraform init
}

# Get ECR repository URL from terraform output
Write-ColorOutput "🔍 Getting ECR repository URL from terraform..." $Blue
try {
    $ECR_REPOSITORY_URL = terraform output -raw ecr_repository_url
    if ([string]::IsNullOrEmpty($ECR_REPOSITORY_URL)) {
        throw "Empty output"
    }
} catch {
    Write-ColorOutput "❌ Error: Could not get ECR repository URL from terraform output" $Red
    Write-ColorOutput "💡 Make sure you've run 'terraform apply' first" $Yellow
    exit 1
}

Write-ColorOutput "✅ ECR Repository: $ECR_REPOSITORY_URL" $Green

# Extract ECR registry URL (before the repository name)
$ECR_REGISTRY = $ECR_REPOSITORY_URL.Split('/')[0]
Write-ColorOutput "📦 ECR Registry: $ECR_REGISTRY" $Blue

# Change to frontend directory
Set-Location "../$FRONTEND_DIR"

# Check if package.json exists
if (-not (Test-Path "package.json")) {
    Write-ColorOutput "❌ Error: package.json not found in $FRONTEND_DIR" $Red
    exit 1
}

Write-ColorOutput "🔨 Building Docker image..." $Blue

# Build Docker image
docker build -t cosine-frontend:latest .

if ($LASTEXITCODE -ne 0) {
    Write-ColorOutput "❌ Error: Docker build failed" $Red
    exit 1
}

Write-ColorOutput "✅ Docker image built successfully" $Green

# Tag image for ECR
Write-ColorOutput "🏷️  Tagging image for ECR..." $Blue
docker tag cosine-frontend:latest "$ECR_REPOSITORY_URL:latest"

# Login to ECR
Write-ColorOutput "🔑 Logging into ECR..." $Blue
$loginCommand = aws ecr get-login-password --region $AWS_REGION
if ($LASTEXITCODE -ne 0) {
    Write-ColorOutput "❌ Error: Failed to get ECR login password" $Red
    Write-ColorOutput "💡 Make sure you have AWS CLI configured and proper permissions" $Yellow
    exit 1
}

$loginCommand | docker login --username AWS --password-stdin $ECR_REGISTRY

if ($LASTEXITCODE -ne 0) {
    Write-ColorOutput "❌ Error: ECR login failed" $Red
    Write-ColorOutput "💡 Make sure you have AWS CLI configured and proper permissions" $Yellow
    exit 1
}

Write-ColorOutput "✅ ECR login successful" $Green

# Push image to ECR
Write-ColorOutput "📤 Pushing image to ECR..." $Blue
docker push "$ECR_REPOSITORY_URL:latest"

if ($LASTEXITCODE -ne 0) {
    Write-ColorOutput "❌ Error: Docker push failed" $Red
    exit 1
}

Write-ColorOutput "✅ Image pushed successfully to ECR" $Green

# Get the website URL
Set-Location "../../terraform"
try {
    $WEBSITE_URL = terraform output -raw frontend_url
} catch {
    $WEBSITE_URL = ""
}

Write-Host ""
Write-ColorOutput "==================================================" $Green
Write-ColorOutput "🎉 DEPLOYMENT COMPLETE!" $Green
Write-ColorOutput "==================================================" $Green
Write-ColorOutput "📦 Docker Image: $ECR_REPOSITORY_URL:latest" $Blue
if (-not [string]::IsNullOrEmpty($WEBSITE_URL)) {
    Write-ColorOutput "🌐 Website URL: $WEBSITE_URL" $Blue
} else {
    Write-ColorOutput "🌐 Get your website URL with: terraform output frontend_url" $Yellow
}
Write-Host ""
Write-ColorOutput "⏳ Note: ECS service may take 2-3 minutes to pull and start the new container" $Yellow
Write-ColorOutput "📊 Monitor deployment: AWS Console → ECS → Services → cosine-frontend-$Environment" $Blue
Write-Host ""
Write-ColorOutput "🔧 Next Steps:" $Green
Write-Host "1. Visit your website URL to test"
Write-Host "2. Check ECS service health in AWS Console"
Write-Host "3. Review CloudWatch logs if needed"
Write-Host "4. Update Cognito callback URLs if authentication fails"
Write-Host ""
