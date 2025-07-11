# Start Both Backend and Frontend Servers
# This script starts both servers in separate processes

Write-Host "Starting Local Development Servers..." -ForegroundColor Green

# Check if backend dependencies are ready
if (-not (Test-Path "venv\Scripts\python.exe")) {
    Write-Host "Virtual environment not found. Please run setup_full_local.ps1 first." -ForegroundColor Red
    exit 1
}

# Check if frontend dependencies are ready
if (-not (Test-Path "frontend\app\node_modules")) {
    Write-Host "Frontend dependencies not found. Please run setup_full_local.ps1 first." -ForegroundColor Red
    exit 1
}

Write-Host "`nStarting backend server..." -ForegroundColor Yellow
# Start backend in background
$backend = Start-Process -FilePath ".\venv\Scripts\python.exe" -ArgumentList "backend_app\local_server.py" -PassThru -WindowStyle Normal

Write-Host "Backend started (PID: $($backend.Id))" -ForegroundColor Green

# Wait a moment for backend to start
Start-Sleep -Seconds 3

Write-Host "`nStarting frontend server..." -ForegroundColor Yellow
# Start frontend in new window
Push-Location "frontend\app"
$frontend = Start-Process -FilePath "npm" -ArgumentList "run", "dev" -PassThru -WindowStyle Normal
Pop-Location

Write-Host "Frontend started (PID: $($frontend.Id))" -ForegroundColor Green

Write-Host "`nBoth servers are starting up!" -ForegroundColor Green
Write-Host "`nURLs:" -ForegroundColor Cyan
Write-Host "  Frontend: http://localhost:3000" -ForegroundColor White
Write-Host "  Robinhood: http://localhost:3000/robinhood" -ForegroundColor White
Write-Host "  Backend API: http://localhost:5000" -ForegroundColor White

Write-Host "`nTo stop servers:" -ForegroundColor Yellow
Write-Host "  Press Ctrl+C in each terminal window" -ForegroundColor White
Write-Host "  Or close the terminal windows" -ForegroundColor White

Write-Host "`nProcess IDs (for manual cleanup if needed):" -ForegroundColor Cyan
Write-Host "  Backend PID: $($backend.Id)" -ForegroundColor White
Write-Host "  Frontend PID: $($frontend.Id)" -ForegroundColor White

# Keep this script running to show status
Write-Host "`nPress any key to exit this monitor..." -ForegroundColor Yellow
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
