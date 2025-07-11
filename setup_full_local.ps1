# Master Local Development Setup
# This script sets up both backend and frontend for local development

Write-Host "Complete Local Development Setup" -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Green

# Step 1: Backend Setup
Write-Host "`nSetting up Backend..." -ForegroundColor Cyan
if (Test-Path "setup_simple.ps1") {
    & ".\setup_simple.ps1"
} else {
    Write-Host "ERROR: setup_simple.ps1 not found. Please run from the root directory." -ForegroundColor Red
    exit 1
}

# Step 2: Frontend Setup
Write-Host "`nSetting up Frontend..." -ForegroundColor Cyan
if (Test-Path "frontend\app") {
    Push-Location "frontend\app"
    
    # Check if Node.js is installed
    node --version 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Node.js not found. Please install Node.js 16+ first." -ForegroundColor Red
        Pop-Location
        exit 1
    }
    
    # Install dependencies if needed
    if (-not (Test-Path "node_modules")) {
        Write-Host "Installing frontend dependencies..." -ForegroundColor Yellow
        npm install
    }
    
    # Create local environment file
    if (-not (Test-Path ".env.local")) {
        Write-Host "Creating frontend environment configuration..." -ForegroundColor Yellow
        $envContent = @"
# Local Development Environment Configuration
NEXT_PUBLIC_ROBINHOOD_API_URL=http://localhost:5000/robinhood
NODE_ENV=development
NEXT_PUBLIC_DEBUG=true
"@
        $envContent | Out-File -FilePath ".env.local" -Encoding utf8
    }
    
    Pop-Location
    Write-Host "Frontend setup complete!" -ForegroundColor Green
} else {
    Write-Host "ERROR: frontend/app directory not found." -ForegroundColor Red
    exit 1
}

# Step 3: Instructions
Write-Host "`nSetup Complete!" -ForegroundColor Green
Write-Host "`nTo start your local development environment:" -ForegroundColor Cyan

Write-Host "`n1. Start Backend Server:" -ForegroundColor Yellow
Write-Host "   python backend_app/local_server.py" -ForegroundColor White

Write-Host "`n2. Start Frontend Server (in new terminal):" -ForegroundColor Yellow
Write-Host "   cd frontend/app" -ForegroundColor White
Write-Host "   npm run dev" -ForegroundColor White

Write-Host "`n3. Open Your Browser:" -ForegroundColor Yellow
Write-Host "   Frontend: http://localhost:3000" -ForegroundColor White
Write-Host "   Robinhood: http://localhost:3000/robinhood" -ForegroundColor White

Write-Host "`nQuick Tests:" -ForegroundColor Cyan
Write-Host "   Test portfolio: python test_portfolio.py" -ForegroundColor White
Write-Host "   Test backend: curl http://localhost:5000/health" -ForegroundColor White

Write-Host "`nFor detailed instructions, see:" -ForegroundColor Cyan
Write-Host "   LOCAL_DEVELOPMENT_GUIDE.md" -ForegroundColor White
