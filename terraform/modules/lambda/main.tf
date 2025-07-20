# modules/lambda/main.tf
# Lambda function module with IAM role and policies

# Create a unique name for the Lambda function
locals {
  function_name = "${var.project_name}-${var.function_name}-${var.environment}"
  role_name     = "${var.project_name}-${var.function_name}-role-${var.environment}"
}

# Data sources for account and region info
data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

# Install dependencies if requirements.txt exists
resource "null_resource" "install_dependencies" {
  count = fileexists("${var.source_dir}/requirements.txt") ? 1 : 0
  
  triggers = {
    # Use source directory hash instead of archive hash to avoid circular dependency
    source_files   = sha1(join("", [for f in fileset(var.source_dir, "**") : filesha1("${var.source_dir}/${f}")]))
    requirements   = filemd5("${var.source_dir}/requirements.txt")
  }

  provisioner "local-exec" {
    command = <<EOF
      if (Test-Path "${path.module}/../../temp/${local.function_name}") { 
        Remove-Item -Recurse -Force "${path.module}/../../temp/${local.function_name}" 
      }
      New-Item -ItemType Directory -Force -Path "${path.module}/../../temp/${local.function_name}"
      Copy-Item -Recurse "${var.source_dir}/*" "${path.module}/../../temp/${local.function_name}/"
      if (Test-Path "${var.source_dir}/requirements.txt") {
        python -m pip install -r "${var.source_dir}/requirements.txt" -t "${path.module}/../../temp/${local.function_name}/" --upgrade
      }
    EOF
    interpreter = ["powershell", "-Command"]
  }
}

# Create ZIP file from source directory or temp directory with dependencies
data "archive_file" "lambda_zip" {
  type        = "zip"
  source_dir  = fileexists("${var.source_dir}/requirements.txt") ? "${path.module}/../../temp/${local.function_name}" : var.source_dir
  output_path = "${path.module}/../../temp/${local.function_name}.zip"
  
  depends_on = [null_resource.install_dependencies]
}

# IAM role for Lambda execution
resource "aws_iam_role" "lambda_role" {
  name = local.role_name
  
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })

  tags = merge(var.tags, {
    Name        = local.role_name
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "Terraform"
  })
}

# Basic Lambda execution policy
resource "aws_iam_role_policy_attachment" "lambda_basic_execution" {
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
  role       = aws_iam_role.lambda_role.name
}

# VPC execution policy (if VPC is configured)
resource "aws_iam_role_policy_attachment" "lambda_vpc_execution" {
  count      = var.vpc_config != null ? 1 : 0
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
  role       = aws_iam_role.lambda_role.name
}

# Custom IAM policy for Lambda function
resource "aws_iam_role_policy" "lambda_custom_policy" {
  name = "${local.function_name}-custom-policy"
  role = aws_iam_role.lambda_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup"
        ]
        Resource = "arn:aws:logs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/${local.function_name}"
      },
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/${local.function_name}:*"
      },
      {
        Effect = "Allow"
        Action = [
          "xray:PutTraceSegments",
          "xray:PutTelemetryRecords"
        ]
        Resource = "*"
      }
    ]
  })
}

# Attach additional IAM policies if provided
resource "aws_iam_role_policy_attachment" "additional_policies" {
  count      = length(var.additional_iam_policies)
  policy_arn = var.additional_iam_policies[count.index]
  role       = aws_iam_role.lambda_role.name
}

# CloudWatch Log Group for Lambda function
resource "aws_cloudwatch_log_group" "lambda_log_group" {
  name              = "/aws/lambda/${local.function_name}"
  retention_in_days = 14
  kms_key_id        = var.kms_key_arn

  tags = merge(var.tags, {
    Name        = "${local.function_name}-logs"
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "Terraform"
  })
}

# Lambda function
resource "aws_lambda_function" "lambda" {
  filename         = data.archive_file.lambda_zip.output_path
  function_name    = local.function_name
  role            = aws_iam_role.lambda_role.arn
  handler         = var.handler
  runtime         = var.runtime
  description     = var.description
  timeout         = var.timeout
  memory_size     = var.memory_size
  publish         = var.publish
  layers          = var.layers
  
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256
  
  reserved_concurrent_executions = var.reserved_concurrent_executions != -1 ? var.reserved_concurrent_executions : null
  kms_key_arn                   = var.kms_key_arn

  dynamic "environment" {
    for_each = length(var.environment_variables) > 0 ? [1] : []
    content {
      variables = var.environment_variables
    }
  }

  dynamic "vpc_config" {
    for_each = var.vpc_config != null ? [var.vpc_config] : []
    content {
      subnet_ids         = vpc_config.value.subnet_ids
      security_group_ids = vpc_config.value.security_group_ids
    }
  }

  dynamic "dead_letter_config" {
    for_each = var.dead_letter_queue_target_arn != null ? [1] : []
    content {
      target_arn = var.dead_letter_queue_target_arn
    }
  }

  tracing_config {
    mode = "Active"
  }

  depends_on = [
    aws_iam_role_policy_attachment.lambda_basic_execution,
    aws_cloudwatch_log_group.lambda_log_group,
  ]

  tags = merge(var.tags, {
    Name        = local.function_name
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "Terraform"
  })
}

# API Gateway permission for Lambda (optional)
resource "aws_lambda_permission" "api_gateway" {
  count         = var.create_api_gateway_permission ? 1 : 0
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.lambda.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = var.api_gateway_rest_api_id != null ? "${var.api_gateway_rest_api_id}/*/*" : null
}

# Lambda function alias for versioning
resource "aws_lambda_alias" "lambda_alias" {
  count            = var.publish ? 1 : 0
  name             = var.environment
  description      = "Alias for ${var.environment} environment"
  function_name    = aws_lambda_function.lambda.function_name
  function_version = aws_lambda_function.lambda.version
}
