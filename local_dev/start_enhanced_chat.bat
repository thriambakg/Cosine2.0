@echo off
REM Enhanced Cosine AI Chat Server - Windows Batch Startup
REM This batch file starts your Strand-powered chat interface

echo.
echo ===============================================
echo    Enhanced Cosine AI Chat Server
echo ===============================================
echo.

REM Get the directory where this batch file is located
set "SCRIPT_DIR=%~dp0"
set "SERVER_FILE=%SCRIPT_DIR%enhanced_chat_server.py"

echo 📂 Script directory: %SCRIPT_DIR%
echo 🔍 Server file: %SERVER_FILE%
echo.

REM Check if server file exists
if not exist "%SERVER_FILE%" (
    echo ❌ Error: Server file not found!
    echo Expected: %SERVER_FILE%
    echo.
    pause
    exit /b 1
)

echo ✅ Server file found!
echo.
echo 🔄 Starting Enhanced Chat Server...
echo 🌐 Server will be available at: http://localhost:8000
echo 🛑 Press Ctrl+C to stop the server
echo.
echo ===============================================
echo.

REM Change to script directory and start server
cd /d "%SCRIPT_DIR%"

REM Try python command
python "%SERVER_FILE%"

REM If python fails, try py command
if errorlevel 1 (
    echo.
    echo ⚠️ Python command failed, trying 'py'...
    py "%SERVER_FILE%"
)

REM If both fail, show error
if errorlevel 1 (
    echo.
    echo ❌ Failed to start server!
    echo.
    echo 💡 Troubleshooting:
    echo    1. Ensure Python is installed
    echo    2. Add Python to your PATH
    echo    3. Try running: python enhanced_chat_server.py
    echo.
    pause
)
