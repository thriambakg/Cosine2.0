# Chat Agent Lambda Container
# This container includes all dependencies for the chat agent

FROM public.ecr.aws/lambda/python:3.11

# Install build dependencies for compiling C extensions
RUN yum update -y && \
    yum install -y gcc gcc-c++ make && \
    yum clean all

# Copy the chat agent code
COPY . ${LAMBDA_TASK_ROOT}

# Install Python dependencies from requirements.txt
# Use --no-build-isolation to avoid issues with pycares
RUN pip install --no-cache-dir --upgrade pip setuptools wheel && \
    pip install --no-cache-dir -r requirements.txt

# Run as non-root (Lambda base image supports UID 1000)
USER 1000

# Set the CMD to your handler
CMD ["lambda_handler.lambda_handler"]