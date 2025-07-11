# Frontend Local Development Setup
# Run this script to start the frontend in local development mode

Write-Host "Setting up Frontend for Local Development..." -ForegroundColor Green

# Check if we're in the right directory
if (-not (Test-Path "package.json")) {
    Write-Host "ERROR: package.json not found. Please run this from the frontend/app directory." -ForegroundColor Red
    Write-Host "Try: cd frontend\app" -ForegroundColor Yellow
    exit 1
}

# Check if Node.js is installed
Write-Host "Checking Node.js installation..." -ForegroundColor Yellow
node --version
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Node.js not found. Please install Node.js 16+ first." -ForegroundColor Red
    exit 1
}

# Check if npm is available
npm --version
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: npm not found. Please install npm." -ForegroundColor Red
    exit 1
}

# Install dependencies if node_modules doesn't exist
if (-not (Test-Path "node_modules")) {
    Write-Host "Installing frontend dependencies..." -ForegroundColor Yellow
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Failed to install dependencies." -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "Dependencies already installed." -ForegroundColor Green
}

# Check if .env.local exists
if (-not (Test-Path ".env.local")) {
    Write-Host "Creating local environment configuration..." -ForegroundColor Yellow
    $envContent = @"
# Local Development Environment Configuration
NEXT_PUBLIC_ROBINHOOD_API_URL=http://localhost:5000/robinhood
NODE_ENV=development
NEXT_PUBLIC_DEBUG=true
"@
    $envContent | Out-File -FilePath ".env.local" -Encoding utf8
    Write-Host "Created .env.local file" -ForegroundColor Green
} else {
    Write-Host "Local environment file already exists." -ForegroundColor Green
}

Write-Host "`nFrontend setup complete!" -ForegroundColor Green
Write-Host "`nTo start the development server:" -ForegroundColor Cyan
Write-Host "npm run dev" -ForegroundColor White
Write-Host "`nThen open: http://localhost:3000" -ForegroundColor White
Write-Host "`nRobinhood integration: http://localhost:3000/robinhood" -ForegroundColor White

Write-Host "`nMake sure your backend server is running at http://localhost:5000" -ForegroundColor Yellow
