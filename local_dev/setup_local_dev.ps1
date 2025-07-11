# Master Setup Script for Local Development
# Run this from the project root to set up the entire local development environment

Write-Host "Setting up Local Development Environment" -ForegroundColor Green
Write-Host "=============================================" -ForegroundColor Green

$projectRoot = $PSScriptRoot

# Check if we're in the right directory
if (-not (Test-Path "local_dev\scripts\setup_full_local.ps1")) {
    Write-Host "ERROR: Please run this script from the project root directory (Cosine2.0)" -ForegroundColor Red
    Write-Host "Current directory: $pwd" -ForegroundColor Yellow
    exit 1
}

Write-Host "Running from project root: $projectRoot" -ForegroundColor Green

# Run the complete setup
Write-Host "`nRunning complete local development setup..." -ForegroundColor Cyan
& ".\local_dev\scripts\setup_full_local.ps1"

if ($LASTEXITCODE -eq 0) {
    Write-Host "`nSetup Complete!" -ForegroundColor Green
    Write-Host "`nYour local development environment is ready!" -ForegroundColor Cyan
    
    Write-Host "`nQuick Start Commands:" -ForegroundColor Yellow
    Write-Host "  Start both servers: .\local_dev\scripts\start_local_dev.ps1" -ForegroundColor White
    Write-Host "  Test portfolio:     python local_dev\tests\test_portfolio.py" -ForegroundColor White
    Write-Host "  Test Robinhood:     python local_dev\tests\test_robinhood.py" -ForegroundColor White
    
    Write-Host "`nDocumentation:" -ForegroundColor Yellow
    Write-Host "  Read: local_dev\LOCAL_DEVELOPMENT_GUIDE.md" -ForegroundColor White
    
    Write-Host "`nURLs (after starting servers):" -ForegroundColor Yellow
    Write-Host "  Frontend:   http://localhost:3000" -ForegroundColor White
    Write-Host "  Robinhood:  http://localhost:3000/robinhood" -ForegroundColor White
    Write-Host "  Backend:    http://localhost:5000" -ForegroundColor White
} else {
    Write-Host "`nSetup failed. Please check the error messages above." -ForegroundColor Red
    exit 1
}
