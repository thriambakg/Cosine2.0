# Chat Agent Lambda Container
# This container includes all dependencies for the chat agent

FROM public.ecr.aws/lambda/python:3.11

# Copy the chat agent code
COPY . ${LAMBDA_TASK_ROOT}

# Install Python dependencies from requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Set the CMD to your handler
CMD ["lambda_handler.lambda_handler"]
