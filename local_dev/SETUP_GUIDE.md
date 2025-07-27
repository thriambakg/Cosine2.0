# Cosine AI Chat Server - Quick Setup Guide

## 🚀 Quick Start Options

### Option 1: Simple Batch File (Recommended for Windows)
```cmd
start_chat_server.bat
```

### Option 2: Enhanced PowerShell Script
```powershell
.\setup_and_start_chat.ps1
```

### Option 3: Original PowerShell Script
```powershell
.\start_chat_server.ps1
```

### Option 4: Direct Python
```cmd
python chat_server.py
```

## 🔧 Troubleshooting

### Python Not Found
If you get "Python was not found", try:

1. **Install Python from Microsoft Store:**
   - Search "Python" in Microsoft Store
   - Install Python 3.11 or later

2. **Install Python from python.org:**
   - Download from https://www.python.org/downloads/
   - Make sure to check "Add Python to PATH" during installation

3. **Use python3 instead:**
   ```cmd
   python3 chat_server.py
   ```

### PowerShell Execution Policy Error
If PowerShell scripts won't run:

1. **Use the batch file instead:**
   ```cmd
   start_chat_server.bat
   ```

2. **Or temporarily allow scripts:**
   ```powershell
   Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
   ```

### Missing Dependencies
The server will automatically fall back to simulation mode if Strands is not available.

To install basic dependencies:
```cmd
pip install requests yfinance pandas numpy
```

### Strands Framework (Optional)
For full AI agent functionality, install the Strands framework:
```cmd
pip install strands
```

## 🌐 Usage

1. Run any of the start scripts above
2. Open your browser to http://localhost:8000
3. Start chatting with your AI financial assistant!

## 📝 Features

- **Stock Analysis**: Ask about any stock ticker (e.g., "What's AAPL doing?")
- **Portfolio Management**: Get portfolio risk analysis and optimization tips
- **Options Trading**: Analyze options strategies and pricing
- **Market Research**: Get market trends and economic insights
- **Crypto Analysis**: Analyze cryptocurrency markets

## 🔄 Modes

- **Full Mode**: When Strands agent is available, provides real financial analysis
- **Simulation Mode**: When agent dependencies are missing, provides helpful responses with guidance

The chat interface will automatically detect which mode to use and inform you accordingly.

Enjoy chatting with your AI financial assistant! 🤖💰
