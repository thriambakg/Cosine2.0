#!/usr/bin/env python3
"""
Warm-up script to pre-import heavy dependencies during container build.
This pre-compiles Python bytecode and caches imports to reduce cold start time.
"""

import sys
import os

# Set environment variables before imports
os.environ.setdefault('OTEL_SDK_DISABLED', 'true')
os.environ.setdefault('OTEL_PYTHON_DISABLED_INSTRUMENTATIONS', 'all')
os.environ.setdefault('STRANDS_DISABLE_METRICS', 'true')
os.environ.setdefault('STRANDS_DISABLED_TELEMETRY', 'true')
os.environ.setdefault('STRANDS_METRICS_ENABLED', 'false')

print("🔥 Warming up imports...")

# Import heavy dependencies to pre-compile bytecode
try:
    print("  → Importing numpy...")
    import numpy
    print("  ✅ numpy imported")
except Exception as e:
    print(f"  ⚠️  numpy import failed: {e}")

try:
    print("  → Importing pandas...")
    import pandas
    print("  ✅ pandas imported")
except Exception as e:
    print(f"  ⚠️  pandas import failed: {e}")

try:
    print("  → Importing matplotlib (this may take ~19s)...")
    import matplotlib
    matplotlib.use('Agg')  # Set backend before pyplot
    import matplotlib.pyplot as plt
    import matplotlib.dates as mdates
    print("  ✅ matplotlib imported")
except Exception as e:
    print(f"  ⚠️  matplotlib import failed: {e}")

try:
    print("  → Importing yfinance...")
    import yfinance as yf
    print("  ✅ yfinance imported")
except Exception as e:
    print(f"  ⚠️  yfinance import failed: {e}")

try:
    print("  → Importing boto3...")
    import boto3
    print("  ✅ boto3 imported")
except Exception as e:
    print(f"  ⚠️  boto3 import failed: {e}")

try:
    print("  → Importing strands...")
    from strands import Agent
    from strands.models import BedrockModel
    print("  ✅ strands imported")
except Exception as e:
    print(f"  ⚠️  strands import failed: {e}")

try:
    print("  → Importing cryptography...")
    from cryptography.fernet import Fernet
    print("  ✅ cryptography imported")
except Exception as e:
    print(f"  ⚠️  cryptography import failed: {e}")

try:
    print("  → Importing requests...")
    import requests
    print("  ✅ requests imported")
except Exception as e:
    print(f"  ⚠️  requests import failed: {e}")

# Import application modules to warm up bytecode
# This pre-compiles .pyc files which are cached in the container
try:
    print("  → Pre-compiling application modules...")
    import py_compile
    import glob
    import os
    
    # Find all Python files recursively
    python_files = []
    for root, dirs, files in os.walk("."):
        # Skip hidden directories and __pycache__
        dirs[:] = [d for d in dirs if not d.startswith('.') and d != '__pycache__']
        for file in files:
            if file.endswith('.py'):
                python_files.append(os.path.join(root, file))
    
    compiled_count = 0
    for py_file in python_files:
        try:
            # Compile to __pycache__ directory
            py_compile.compile(py_file, doraise=False)
            compiled_count += 1
        except Exception:
            # Skip files that can't be compiled (may have dependencies or syntax errors)
            pass
    
    print(f"  ✅ {compiled_count} application modules pre-compiled")
except Exception as e:
    print(f"  ⚠️  Module pre-compilation failed: {e}")

print("✅ Warm-up complete! All imports cached and bytecode compiled.")

