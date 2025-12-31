# Chat Agent Lambda Container
# This container includes all dependencies for the chat agent
# Optimized for cold start performance with pre-warmed imports

FROM public.ecr.aws/lambda/python:3.11

# Install build dependencies for compiling C extensions
RUN yum update -y && \
    yum install -y gcc gcc-c++ make && \
    yum clean all

# Copy requirements.txt first for better Docker layer caching
COPY requirements.txt ${LAMBDA_TASK_ROOT}/

# Install Python dependencies from requirements.txt
# Use --no-build-isolation to avoid issues with pycares
# Install in separate layer for better caching
RUN pip install --no-cache-dir --upgrade pip setuptools wheel && \
    pip install --no-cache-dir -r requirements.txt

# Copy warm-up script
COPY warmup_imports.py ${LAMBDA_TASK_ROOT}/

# Copy the chat agent code
COPY . ${LAMBDA_TASK_ROOT}

# Run warm-up script to pre-import heavy dependencies and compile bytecode
# This happens during build time, not runtime, so it doesn't affect cold starts
# The compiled .pyc files and cached imports will be in the image
RUN python3 warmup_imports.py || echo "Warm-up script completed with warnings"

# Set Python to optimize bytecode (remove docstrings, etc.)
# This reduces file size and import time
ENV PYTHONOPTIMIZE=1

# Set the CMD to your handler
CMD ["lambda_handler.lambda_handler"]