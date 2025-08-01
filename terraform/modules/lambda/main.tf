# Security-Compliant Lambda Module
# modules/lambda/main.tf
# Optimized for AI Agent Chat System and Cosine2.0 Backend

# IAM Role for Lambda execution with minimal required permissions
resource "aws_iam_role" "lambda_execution_role" {
  name = "${var.project_name}-${var.function_name}-role-${var.environment}"

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
    Name        = "${var.project_name}-${var.function_name}-role-${var.environment}"
    Component   = "Lambda"
    Purpose     = "ExecutionRole"
    Environment = var.environment
  })
}

# Basic execution policy attachment
resource "aws_iam_role_policy_attachment" "lambda_basic_execution" {
  role       = aws_iam_role.lambda_execution_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# VPC access policy (conditional)
resource "aws_iam_role_policy_attachment" "lambda_vpc_access" {
  count      = var.vpc_config != null ? 1 : 0
  role       = aws_iam_role.lambda_execution_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

# Custom IAM policy for additional permissions
resource "aws_iam_role_policy" "lambda_custom_policy" {
  count = length(var.custom_policies) > 0 ? 1 : 0
  name  = "${var.project_name}-${var.function_name}-custom-policy-${var.environment}"
  role  = aws_iam_role.lambda_execution_role.id

  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = var.custom_policies
  })
}

# Lambda Layer for dependencies (reusable across functions)
resource "aws_lambda_layer_version" "dependencies" {
  for_each = var.lambda_layers

  filename                 = each.value.filename
  layer_name               = "${var.project_name}-${each.key}-${var.environment}"
  description              = each.value.description
  compatible_runtimes      = each.value.compatible_runtimes
  source_code_hash         = each.value.source_code_hash
  compatible_architectures = var.architectures

  lifecycle {
    create_before_destroy = true
  }
}

# CloudWatch Log Group with compliance settings
resource "aws_cloudwatch_log_group" "lambda_logs" {
  name              = "/aws/lambda/${var.project_name}-${var.function_name}-${var.environment}"
  retention_in_days = var.log_retention_days
  kms_key_id        = var.kms_key_id

  tags = merge(var.tags, {
    Name        = "${var.project_name}-${var.function_name}-logs-${var.environment}"
    Component   = "CloudWatch"
    Purpose     = "LambdaLogs"
    Environment = var.environment
  })
}

# Lambda Function with security compliance
resource "aws_lambda_function" "function" {
  function_name                  = "${var.project_name}-${var.function_name}-${var.environment}"
  description                    = var.description
  role                           = aws_iam_role.lambda_execution_role.arn
  handler                        = var.handler
  runtime                        = var.runtime
  timeout                        = var.timeout
  memory_size                    = var.memory_size
  reserved_concurrent_executions = var.reserved_concurrency
  architectures                  = var.architectures

  # Source code configuration
  filename         = var.deployment_package.filename
  source_code_hash = var.deployment_package.source_code_hash

  # Attach layers (both external and module-created)
  layers = concat(
    [for layer in aws_lambda_layer_version.dependencies : layer.arn],
    var.external_layer_arns
  )

  # Environment variables with encryption
  dynamic "environment" {
    for_each = length(var.environment_variables) > 0 ? [1] : []
    content {
      variables = var.environment_variables
    }
  }

  # KMS encryption for environment variables (CKV compliance)
  kms_key_arn = var.kms_key_id

  # VPC configuration for secure network access
  dynamic "vpc_config" {
    for_each = var.vpc_config != null ? [var.vpc_config] : []
    content {
      subnet_ids         = vpc_config.value.subnet_ids
      security_group_ids = vpc_config.value.security_group_ids
    }
  }

  # Dead letter queue configuration for error handling
  dynamic "dead_letter_config" {
    for_each = var.dead_letter_queue_arn != null ? [1] : []
    content {
      target_arn = var.dead_letter_queue_arn
    }
  }

  # Tracing configuration for observability
  tracing_config {
    mode = var.tracing_mode
  }

  # File system configuration (if needed for large dependencies)
  dynamic "file_system_config" {
    for_each = var.file_system_config != null ? [var.file_system_config] : []
    content {
      arn              = file_system_config.value.arn
      local_mount_path = file_system_config.value.local_mount_path
    }
  }

  depends_on = [
    aws_iam_role_policy_attachment.lambda_basic_execution,
    aws_iam_role_policy_attachment.lambda_vpc_access,
    aws_cloudwatch_log_group.lambda_logs,
  ]

  tags = merge(var.tags, {
    Name        = "${var.project_name}-${var.function_name}-${var.environment}"
    Component   = "Lambda"
    Purpose     = var.purpose
    Environment = var.environment
    Runtime     = var.runtime
  })

  # Security compliance lifecycle rules
  lifecycle {
    precondition {
      condition     = var.kms_key_id != null && var.kms_key_id != ""
      error_message = "CKV_AWS_173: Lambda function must use KMS encryption for environment variables."
    }

    precondition {
      condition     = var.log_retention_days >= 1 && var.log_retention_days <= 3653
      error_message = "CloudWatch log retention must be between 1 and 3653 days for compliance."
    }

    precondition {
      condition     = var.timeout >= 1 && var.timeout <= 900
      error_message = "Lambda timeout must be between 1 and 900 seconds."
    }

    precondition {
      condition     = var.memory_size >= 128 && var.memory_size <= 10240
      error_message = "Lambda memory must be between 128 MB and 10,240 MB."
    }
  }
}

# CloudWatch Alarms for monitoring
resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  count = var.enable_monitoring ? 1 : 0

  alarm_name          = "${var.project_name}-${var.function_name}-errors-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = "60"
  statistic           = "Sum"
  threshold           = var.error_threshold
  alarm_description   = "This metric monitors lambda errors for ${var.function_name}"
  alarm_actions       = var.alarm_sns_topic_arns

  dimensions = {
    FunctionName = aws_lambda_function.function.function_name
  }

  tags = merge(var.tags, {
    Name        = "${var.project_name}-${var.function_name}-errors-alarm-${var.environment}"
    Component   = "CloudWatch"
    Purpose     = "ErrorMonitoring"
    Environment = var.environment
  })
}

resource "aws_cloudwatch_metric_alarm" "lambda_duration" {
  count = var.enable_monitoring ? 1 : 0

  alarm_name          = "${var.project_name}-${var.function_name}-duration-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "Duration"
  namespace           = "AWS/Lambda"
  period              = "60"
  statistic           = "Average"
  threshold           = var.duration_threshold
  alarm_description   = "This metric monitors lambda duration for ${var.function_name}"
  alarm_actions       = var.alarm_sns_topic_arns

  dimensions = {
    FunctionName = aws_lambda_function.function.function_name
  }

  tags = merge(var.tags, {
    Name        = "${var.project_name}-${var.function_name}-duration-alarm-${var.environment}"
    Component   = "CloudWatch"
    Purpose     = "PerformanceMonitoring"
    Environment = var.environment
  })
}

# API Gateway permissions (for chat AI integration)
resource "aws_lambda_permission" "api_gateway" {
  count = var.api_gateway_integration != null ? 1 : 0

  statement_id  = "AllowExecutionFromAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.function.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${var.api_gateway_integration.execution_arn}/*/*"
}

# EventBridge permissions (for scheduled executions)
resource "aws_lambda_permission" "eventbridge" {
  for_each = var.eventbridge_rules

  statement_id  = "AllowExecutionFromEventBridge-${each.key}"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.function.function_name
  principal     = "events.amazonaws.com"
  source_arn    = each.value.rule_arn
}

# S3 permissions (for file processing)
resource "aws_lambda_permission" "s3" {
  for_each = var.s3_bucket_notifications

  statement_id  = "AllowExecutionFromS3-${each.key}"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.function.function_name
  principal     = "s3.amazonaws.com"
  source_arn    = each.value.bucket_arn
}

# Application Auto Scaling for provisioned concurrency (enterprise feature)
resource "aws_appautoscaling_target" "lambda_target" {
  count = var.provisioned_concurrency != null ? 1 : 0

  max_capacity       = var.provisioned_concurrency.max_capacity
  min_capacity       = var.provisioned_concurrency.min_capacity
  resource_id        = "function:${aws_lambda_function.function.function_name}:provisioned"
  scalable_dimension = "lambda:function:ProvisionedConcurrencyUtilization"
  service_namespace  = "lambda"

  tags = merge(var.tags, {
    Name        = "${var.project_name}-${var.function_name}-autoscaling-${var.environment}"
    Component   = "AutoScaling"
    Purpose     = "ProvisionedConcurrency"
    Environment = var.environment
  })
}

resource "aws_appautoscaling_policy" "lambda_policy" {
  count = var.provisioned_concurrency != null ? 1 : 0

  name               = "${var.project_name}-${var.function_name}-scaling-policy-${var.environment}"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.lambda_target[0].resource_id
  scalable_dimension = aws_appautoscaling_target.lambda_target[0].scalable_dimension
  service_namespace  = aws_appautoscaling_target.lambda_target[0].service_namespace

  target_tracking_scaling_policy_configuration {
    target_value = var.provisioned_concurrency.target_utilization

    predefined_metric_specification {
      predefined_metric_type = "LambdaProvisionedConcurrencyUtilization"
    }
  }
}
