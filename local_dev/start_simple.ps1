# Simple Chat Server Starter
Write-Host "🤖 Starting Cosine AI Chat Server..." -ForegroundColor Cyan

# Check if chat_server.py exists
if (-not (Test-Path "chat_server.py")) {
    Write-Host "❌ chat_server.py not found in current directory" -ForegroundColor Red
    Write-Host "💡 Make sure you're in the local_dev directory" -ForegroundColor Yellow
    exit 1
}

# Try to start with python
try {
    python chat_server.py
} catch {
    # Try with python3
    try {
        python3 chat_server.py
    } catch {
        Write-Host "❌ Could not start server with python or python3" -ForegroundColor Red
        Write-Host "💡 Please install Python from python.org" -ForegroundColor Yellow
        exit 1
    }
}
