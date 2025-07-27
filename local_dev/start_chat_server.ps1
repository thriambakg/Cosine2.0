# Cosine AI Chat - Local Development Server
# This script starts the local chat interface server

Write-Host "🤖 Starting Cosine AI Chat Local Development Server..." -ForegroundColor Cyan

# Check if Python is available
try {
    $pythonVersion = & python --version 2>$null
    if ($pythonVersion) {
        Write-Host "✅ Python found: $pythonVersion" -ForegroundColor Green
    } else {
        throw "Python not accessible"
    }
} catch {
    Write-Host "❌ Python not found. Please install Python 3.7+ and try again." -ForegroundColor Red
    Write-Host "💡 You can install Python from: https://www.python.org/downloads/" -ForegroundColor Yellow
    exit 1
}

# Check if required packages are available
Write-Host "📦 Checking dependencies..." -ForegroundColor Yellow

$requirements = @(
    "strands",
    "yfinance", 
    "pandas",
    "numpy"
)

foreach ($package in $requirements) {
    try {
        $importName = $package
        if ($package -eq "strands") {
            $importName = "strands"
        }
        
        $result = & python -c "import $importName; print('OK')" 2>$null
        if ($result -eq "OK") {
            Write-Host "✅ $package is available" -ForegroundColor Green
        } else {
            Write-Host "⚠️  $package not found - some features may be limited" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "⚠️  $package not found - some features may be limited" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "🚀 Starting chat server on http://localhost:8000" -ForegroundColor Cyan
Write-Host "📱 Open your browser to http://localhost:8000 to start chatting" -ForegroundColor Green
Write-Host "🛑 Press Ctrl+C to stop the server" -ForegroundColor Gray
Write-Host ""

# Start the server
try {
    & python chat_server.py
} catch {
    Write-Host "❌ Failed to start server. Check error messages above." -ForegroundColor Red
    Write-Host "💡 Make sure you're in the local_dev directory and chat_server.py exists." -ForegroundColor Yellow
    exit 1
}
