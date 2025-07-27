# Enhanced Cosine AI Chat Server Startup Script
# This script starts the enhanced chat server with your Strand agent

Write-Host "🚀 Enhanced Cosine AI Chat Server" -ForegroundColor Cyan
Write-Host "=" * 50 -ForegroundColor Cyan

# Get script directory
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$ServerPath = Join-Path $ScriptDir "enhanced_chat_server.py"

Write-Host "📂 Script directory: $ScriptDir" -ForegroundColor Green
Write-Host "🔍 Looking for server at: $ServerPath" -ForegroundColor Green

# Check if the server file exists
if (-not (Test-Path $ServerPath)) {
    Write-Host "❌ Error: Server file not found!" -ForegroundColor Red
    Write-Host "Expected location: $ServerPath" -ForegroundColor Yellow
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "✅ Server file found!" -ForegroundColor Green

# Try to start the server
try {
    Write-Host "🔄 Starting Enhanced Chat Server..." -ForegroundColor Cyan
    Write-Host "🌐 Server will be available at: http://localhost:8000" -ForegroundColor Yellow
    Write-Host "🛑 Press Ctrl+C to stop the server" -ForegroundColor Yellow
    Write-Host "=" * 50 -ForegroundColor Cyan
    
    # Change to the script directory and run the server
    Set-Location $ScriptDir
    python $ServerPath
    
} catch {
    Write-Host "❌ Error starting server: $_" -ForegroundColor Red
    Write-Host "💡 Troubleshooting:" -ForegroundColor Yellow
    Write-Host "   1. Ensure Python is installed and in PATH" -ForegroundColor White
    Write-Host "   2. Try running: python enhanced_chat_server.py" -ForegroundColor White
    Write-Host "   3. Check if required packages are installed" -ForegroundColor White
    
    Read-Host "Press Enter to exit"
}
