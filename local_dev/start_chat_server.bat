@echo off
echo 🤖 Starting Cosine AI Chat Local Development Server...
echo.

REM Check if Python is available
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Python not found. Please install Python 3.7+ and try again.
    echo 💡 Download from: https://www.python.org/downloads/
    pause
    exit /b 1
)

echo ✅ Python found
echo.

echo 📦 Installing/checking dependencies...
pip install requests yfinance pandas numpy --quiet --disable-pip-version-check

echo.
echo 🚀 Starting chat server on http://localhost:8000
echo 📱 Open your browser to http://localhost:8000 to start chatting
echo 🛑 Press Ctrl+C to stop the server
echo.

REM Start the server
python chat_server.py

if %errorlevel% neq 0 (
    echo.
    echo ❌ Failed to start server
    echo 💡 Make sure you're in the local_dev directory and chat_server.py exists
    pause
)
