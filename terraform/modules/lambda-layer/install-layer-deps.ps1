# install-layer-deps.ps1
# Script to install Python dependencies for Lambda layer using virtual environment

param(
    [string]$ModulePath,
    [string]$RequirementsFile
)

$layerPath = Join-Path $ModulePath "layer\python"
$venvPath = Join-Path $ModulePath "venv"

Write-Host "Installing Lambda layer dependencies using virtual environment..."
Write-Host "Module Path: $ModulePath"
Write-Host "Layer Path: $layerPath"

# Clean up existing directories
if (Test-Path $layerPath) {
    Write-Host "Cleaning up existing layer directory..."
    Remove-Item -Recurse -Force $layerPath
}

if (Test-Path $venvPath) {
    Write-Host "Cleaning up existing virtual environment..."
    Remove-Item -Recurse -Force $venvPath
}

# Create layer directory
New-Item -ItemType Directory -Force -Path $layerPath | Out-Null

try {
    # Create virtual environment with Python 3.11 if available, otherwise use default
    Write-Host "Creating virtual environment..."
    $pythonCmd = "python"
    if (Get-Command "python3.11" -ErrorAction SilentlyContinue) {
        $pythonCmd = "python3.11"
    } elseif (Get-Command "python3" -ErrorAction SilentlyContinue) {
        $pythonCmd = "python3"
    }
    
    & $pythonCmd -m venv $venvPath
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to create virtual environment"
    }

    # Activate virtual environment
    $activateScript = Join-Path $venvPath "Scripts\Activate.ps1"
    if (Test-Path $activateScript) {
        Write-Host "Activating virtual environment..."
        & $activateScript
    } else {
        throw "Virtual environment activation script not found"
    }

    # Upgrade pip in virtual environment
    Write-Host "Upgrading pip in virtual environment..."
    python -m pip install --upgrade pip setuptools wheel

    # Install dependencies
    Write-Host "Installing dependencies..."
    python -m pip install -r $RequirementsFile -t $layerPath --no-deps --platform any --implementation py3 --abi none 2>&1
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Platform-agnostic installation failed, trying with dependencies..."
        python -m pip install -r $RequirementsFile -t $layerPath
    }

    if ($LASTEXITCODE -eq 0) {
        Write-Host "Dependencies installed successfully!"
        
        # List installed packages for verification
        Write-Host "Installed packages:"
        Get-ChildItem $layerPath -Directory | ForEach-Object { Write-Host "  - $($_.Name)" }
    } else {
        Write-Error "Failed to install dependencies"
        exit 1
    }
} catch {
    Write-Error "Error during installation: $_"
    exit 1
} finally {
    # Deactivate virtual environment if it was activated
    if (Get-Command "deactivate" -ErrorAction SilentlyContinue) {
        deactivate
    }
    
    # Clean up virtual environment
    if (Test-Path $venvPath) {
        Write-Host "Cleaning up virtual environment..."
        Remove-Item -Recurse -Force $venvPath -ErrorAction SilentlyContinue
    }
}
