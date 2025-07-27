# Simple Chat Server Setup and Start Script
# This script will install dependencies and start the chat server

Write-Host "🤖 Cosine AI Chat - Setup & Start" -ForegroundColor Cyan
Write-Host "=================================" -ForegroundColor Cyan

# Check Python installation
Write-Host "🔍 Checking Python installation..." -ForegroundColor Yellow

try {
    $pythonPath = Get-Command python -ErrorAction Stop
    $pythonVersion = & python --version 2>$null
    Write-Host "✅ Python found at: $($pythonPath.Source)" -ForegroundColor Green
    Write-Host "✅ Version: $pythonVersion" -ForegroundColor Green
} catch {
    try {
        $python3Path = Get-Command python3 -ErrorAction Stop
        $python3Version = & python3 --version 2>$null
        Write-Host "✅ Python3 found at: $($python3Path.Source)" -ForegroundColor Green
        Write-Host "✅ Version: $python3Version" -ForegroundColor Green
        # Use python3 instead of python
        Set-Alias -Name python -Value python3
    } catch {
        Write-Host "❌ Python not found in PATH" -ForegroundColor Red
        Write-Host "💡 Please install Python from: https://www.python.org/downloads/" -ForegroundColor Yellow
        Write-Host "💡 Or install from Microsoft Store: ms-windows-store://pdp/?ProductId=9PJPW5LDXLZ5" -ForegroundColor Yellow
        Read-Host "Press Enter to exit"
        exit 1
    }
}

# Install dependencies if needed
Write-Host ""
Write-Host "📦 Installing/checking dependencies..." -ForegroundColor Yellow

$packagesToInstall = @()

# Check each package and collect missing ones
$packages = @("requests", "yfinance", "pandas", "numpy")

Write-Host "ℹ️  Note: Strands framework integration will be checked when server starts" -ForegroundColor Cyan

foreach ($package in $packages) {
    try {
        $result = & python -c "import $package; print('OK')" 2>$null
        if ($result -eq "OK") {
            Write-Host "✅ $package is already installed" -ForegroundColor Green
        } else {
            Write-Host "⚠️  $package not found - will install" -ForegroundColor Yellow
            $packagesToInstall += $package
        }
    } catch {
        Write-Host "⚠️  $package not found - will install" -ForegroundColor Yellow
        $packagesToInstall += $package
    }
}

# Install missing packages
if ($packagesToInstall.Count -gt 0) {
    Write-Host ""
    Write-Host "🚀 Installing missing packages: $($packagesToInstall -join ', ')" -ForegroundColor Cyan
    
    foreach ($package in $packagesToInstall) {
        Write-Host "Installing $package..." -ForegroundColor Yellow
        try {
            & python -m pip install $package
            Write-Host "✅ $package installed successfully" -ForegroundColor Green
        } catch {
            Write-Host "⚠️  Failed to install $package - continuing anyway" -ForegroundColor Yellow
        }
    }
} else {
    Write-Host "✅ All required packages are already installed" -ForegroundColor Green
}

Write-Host ""
Write-Host "🚀 Starting Cosine AI Chat Server..." -ForegroundColor Cyan
Write-Host "📱 Server will be available at: http://localhost:8000" -ForegroundColor Green
Write-Host "🛑 Press Ctrl+C to stop the server" -ForegroundColor Gray
Write-Host ""

# Start the server
try {
    & python chat_server.py
} catch {
    Write-Host ""
    Write-Host "❌ Failed to start server" -ForegroundColor Red
    Write-Host "💡 Error details:" -ForegroundColor Yellow
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host ""
    Write-Host "🔧 Troubleshooting tips:" -ForegroundColor Yellow
    Write-Host "  1. Make sure you're in the local_dev directory" -ForegroundColor White
    Write-Host "  2. Check that chat_server.py exists in this directory" -ForegroundColor White
    Write-Host "  3. Try running: python chat_server.py directly" -ForegroundColor White
    
    Read-Host "Press Enter to exit"
    exit 1
}
