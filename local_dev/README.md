# 📁 Local Development Directory

This directory contains all files needed for local development and testing of the Robinhood investment website. It's organized to keep local development separate from AWS deployment files.

## 📂 Directory Structure

```
local_dev/
├── backend/                           # Local backend server
│   └── local_server.py               # Flask development server
├── frontend/                          # Frontend-specific local files
├── scripts/                           # Setup and utility scripts
│   ├── setup_simple.ps1              # Basic backend setup
│   ├── setup_full_local.ps1          # Complete setup (backend + frontend)
│   ├── setup_frontend_simple.ps1     # Frontend-only setup
│   └── start_local_dev.ps1           # Start both servers
├── tests/                             # Test scripts
│   ├── test_portfolio.py             # Portfolio analysis tests
│   ├── test_simple.py                # Simple component tests
│   └── test_robinhood.py             # Robinhood integration tests
├── LOCAL_DEVELOPMENT_GUIDE.md         # Detailed setup guide
├── setup_local_dev.ps1               # Master setup script
└── README.md                         # This file
```

## 🚀 Quick Start

### Option 1: Complete Setup (Recommended)
```powershell
# From project root (Cosine2.0/)
.\local_dev\setup_local_dev.ps1
```

### Option 2: Manual Setup
```powershell
# Backend only
.\local_dev\scripts\setup_simple.ps1

# Frontend only
.\local_dev\scripts\setup_frontend_simple.ps1

# Start both servers
.\local_dev\scripts\start_local_dev.ps1
```

## 🧪 Testing

### Portfolio Analysis (Offline)
```powershell
python local_dev\tests\test_portfolio.py
```

### Simple Component Tests
```powershell
python local_dev\tests\test_simple.py
```

### Robinhood Integration (Real/Mock)
```powershell
python local_dev\tests\test_robinhood.py
```

## 📚 Documentation

- **[LOCAL_DEVELOPMENT_GUIDE.md](LOCAL_DEVELOPMENT_GUIDE.md)** - Complete setup and usage guide
- **[../ROBINHOOD_INTEGRATION_GUIDE.md](../ROBINHOOD_INTEGRATION_GUIDE.md)** - Robinhood-specific documentation

## 🔧 What's Different Here

### Import Paths
All Python files in this directory use updated import paths that navigate from `local_dev/` to the main backend source:

```python
# Navigate to backend source from local_dev/tests/ or local_dev/backend/
backend_path = os.path.join(current_dir, '..', '..', 'backend_app', 'src', 'stocks')
```

### Script Paths
All PowerShell scripts navigate to the project root and use relative paths:

```powershell
# Navigate to project root (go up from local_dev/scripts/)
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $projectRoot
```

### File References
All documentation and scripts reference the new file locations:

- `python local_dev\backend\local_server.py` (instead of `backend_app\local_server.py`)
- `python local_dev\tests\test_portfolio.py` (instead of `test_portfolio.py`)

## 🚨 Important Notes

1. **Separation of Concerns**: This directory is completely separate from AWS deployment files
2. **No AWS Interference**: Running local development won't affect AWS deployment configuration
3. **Updated Import Paths**: All Python files have been updated to work from the new location
4. **Relative Script Paths**: All PowerShell scripts work relative to the project root

## 🌐 URLs (After Setup)

- **Frontend**: http://localhost:3000
- **Robinhood Page**: http://localhost:3000/robinhood  
- **Backend API**: http://localhost:5000/robinhood
- **Health Check**: http://localhost:5000/health

## 🔄 Migration from Root Level

The following files were moved from the project root to this directory:

**Moved to `local_dev/backend/`:**
- `backend_app/local_server.py` → `local_dev/backend/local_server.py`

**Moved to `local_dev/tests/`:**
- `test_portfolio.py` → `local_dev/tests/test_portfolio.py`
- `test_simple.py` → `local_dev/tests/test_simple.py`
- `test_robinhood.py` → `local_dev/tests/test_robinhood.py`

**Moved to `local_dev/scripts/`:**
- `setup_simple.ps1` → `local_dev/scripts/setup_simple.ps1`
- `setup_full_local.ps1` → `local_dev/scripts/setup_full_local.ps1`
- `setup_frontend_simple.ps1` → `local_dev/scripts/setup_frontend_simple.ps1`
- `start_local_dev.ps1` → `local_dev/scripts/start_local_dev.ps1`

**Moved to `local_dev/`:**
- `LOCAL_DEVELOPMENT_GUIDE.md` → `local_dev/LOCAL_DEVELOPMENT_GUIDE.md`

All import paths and script references have been updated accordingly!
