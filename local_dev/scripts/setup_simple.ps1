# Simple Setup Script for Local Development
# This script focuses on essential setup without complex formatting

Write-Host "Setting up Local Development Environment..." -ForegroundColor Green

# Navigate to project root (go up two levels from local_dev/scripts/)
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $projectRoot

# Check Python
Write-Host "Checking Python installation..." -ForegroundColor Yellow
python --version
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Python not found. Please install Python 3.8+." -ForegroundColor Red
    exit 1
}

# Create virtual environment if it doesn't exist
if (-not (Test-Path "venv")) {
    Write-Host "Creating virtual environment..." -ForegroundColor Yellow
    python -m venv venv
}

# Activate virtual environment
Write-Host "Activating virtual environment..." -ForegroundColor Yellow
& ".\venv\Scripts\Activate.ps1"

# Install dependencies
Write-Host "Installing dependencies..." -ForegroundColor Yellow
pip install -r requirements.txt

# Create environment file
Write-Host "Creating environment configuration..." -ForegroundColor Yellow
$envContent = @"
# Local Development Configuration
NEXT_PUBLIC_ROBINHOOD_API_URL=http://localhost:5000/robinhood
FLASK_ENV=development
FLASK_DEBUG=1
"@

$envContent | Out-File -FilePath ".env.example" -Encoding utf8

Write-Host "Setup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. Test with: python local_dev\tests\test_robinhood.py" -ForegroundColor White
Write-Host "2. Start server: python local_dev\backend\local_server.py" -ForegroundColor White
Write-Host "3. Read local_dev\LOCAL_DEVELOPMENT_GUIDE.md for more details" -ForegroundColor White
