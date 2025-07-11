# Simple Frontend Setup
# Run this from the local_dev/scripts directory to set up frontend for local development

Write-Host "Setting up Frontend..." -ForegroundColor Green

# Navigate to project root (go up two levels from local_dev/scripts/)
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $projectRoot

# Check if we can find the frontend directory
if (-not (Test-Path "frontend\app")) {
    Write-Host "ERROR: frontend\app directory not found." -ForegroundColor Red
    Write-Host "Please ensure you're running from the correct location." -ForegroundColor Yellow
    exit 1
}

# Navigate to frontend directory
Set-Location "frontend\app"

# Check Node.js
Write-Host "Checking Node.js..." -ForegroundColor Yellow
node --version
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Node.js not found. Please install Node.js 16+." -ForegroundColor Red
    exit 1
}

# Install dependencies
Write-Host "Installing dependencies..." -ForegroundColor Yellow
npm install

# Create environment file
Write-Host "Creating environment file..." -ForegroundColor Yellow
$env = "NEXT_PUBLIC_ROBINHOOD_API_URL=http://localhost:5000/robinhood`nNODE_ENV=development"
$env | Out-File ".env.local" -Encoding ascii

Write-Host "Frontend setup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "To start frontend:" -ForegroundColor Cyan
Write-Host "npm run dev" -ForegroundColor White
Write-Host ""
Write-Host "Then open: http://localhost:3000/robinhood" -ForegroundColor White
