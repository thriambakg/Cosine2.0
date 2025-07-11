# Cosine App Module - Main Infrastructure

# Data sources for Lambda packaging
data "archive_file" "lambda_zip" {
  type        = "zip"
  source_dir  = "../../../backend_app/src/stocks/stock_statistics/app"
  output_path = "./lambda_function.zip"
}

data "archive_file" "robinhood_lambda_zip" {
  type        = "zip"
  source_dir  = "../../../backend_app/src/stocks/robinhood_integration/app"
  output_path = "./robinhood_lambda_function.zip"
}

# IAM Role for Lambda functions
resource "aws_iam_role" "lambda_role" {
  name = "${var.project_name}-lambda-role-${var.environment}"
  
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  tags = var.common_tags
}

# IAM Policy for Lambda execution
resource "aws_iam_role_policy_attachment" "lambda_basic_execution" {
  role       = aws_iam_role.lambda_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Additional IAM policy for Lambda functions (if needed for AWS services)
resource "aws_iam_role_policy" "lambda_policy" {
  name = "${var.project_name}-lambda-policy-${var.environment}"
  role = aws_iam_role.lambda_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:*"
      }
      # Add more permissions here as needed (S3, DynamoDB, etc.)
    ]
  })
}

# Portfolio Statistics Lambda Function
resource "aws_lambda_function" "portfolio_stats" {
  function_name    = "${var.project_name}-portfolio-stats-${var.environment}"
  handler         = "lambda_function.lambda_handler"
  runtime         = var.lambda_runtime
  role            = aws_iam_role.lambda_role.arn
  filename        = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256
  timeout         = var.lambda_timeout

  environment {
    variables = {
      LOG_LEVEL   = var.log_level
      ENVIRONMENT = var.environment
    }
  }

  tags = merge(var.common_tags, {
    Name = "Portfolio Statistics Lambda"
  })
}

# Robinhood Integration Lambda Function
resource "aws_lambda_function" "robinhood_integration" {
  function_name    = "${var.project_name}-robinhood-integration-${var.environment}"
  handler         = "lambda_function.lambda_handler"
  runtime         = var.lambda_runtime
  role            = aws_iam_role.lambda_role.arn
  filename        = data.archive_file.robinhood_lambda_zip.output_path
  source_code_hash = data.archive_file.robinhood_lambda_zip.output_base64sha256
  timeout         = var.robinhood_lambda_timeout
  
  environment {
    variables = {
      LOG_LEVEL   = var.log_level
      ENVIRONMENT = var.environment
    }
  }

  tags = merge(var.common_tags, {
    Name = "Robinhood Integration Lambda"
  })
}

# API Gateway REST API
resource "aws_api_gateway_rest_api" "robinhood_api" {
  name        = "${var.project_name}-robinhood-api-${var.environment}"
  description = "API Gateway for Robinhood portfolio integration - ${var.environment}"
  
  endpoint_configuration {
    types = ["REGIONAL"]
  }

  tags = merge(var.common_tags, {
    Name = "Cosine Robinhood API"
  })
}

# API Gateway Resource
resource "aws_api_gateway_resource" "robinhood_resource" {
  rest_api_id = aws_api_gateway_rest_api.robinhood_api.id
  parent_id   = aws_api_gateway_rest_api.robinhood_api.root_resource_id
  path_part   = "robinhood"
}

# API Gateway Methods and Integrations
resource "aws_api_gateway_method" "robinhood_method" {
  rest_api_id   = aws_api_gateway_rest_api.robinhood_api.id
  resource_id   = aws_api_gateway_resource.robinhood_resource.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_method" "robinhood_options_method" {
  rest_api_id   = aws_api_gateway_rest_api.robinhood_api.id
  resource_id   = aws_api_gateway_resource.robinhood_resource.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "robinhood_integration" {
  rest_api_id = aws_api_gateway_rest_api.robinhood_api.id
  resource_id = aws_api_gateway_resource.robinhood_resource.id
  http_method = aws_api_gateway_method.robinhood_method.http_method

  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.robinhood_integration.invoke_arn
}

resource "aws_api_gateway_integration" "robinhood_options_integration" {
  rest_api_id = aws_api_gateway_rest_api.robinhood_api.id
  resource_id = aws_api_gateway_resource.robinhood_resource.id
  http_method = aws_api_gateway_method.robinhood_options_method.http_method

  type = "MOCK"
  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

# CORS Configuration
resource "aws_api_gateway_method_response" "robinhood_options_response" {
  rest_api_id = aws_api_gateway_rest_api.robinhood_api.id
  resource_id = aws_api_gateway_resource.robinhood_resource.id
  http_method = aws_api_gateway_method.robinhood_options_method.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "robinhood_options_integration_response" {
  rest_api_id = aws_api_gateway_rest_api.robinhood_api.id
  resource_id = aws_api_gateway_resource.robinhood_resource.id
  http_method = aws_api_gateway_method.robinhood_options_method.http_method
  status_code = aws_api_gateway_method_response.robinhood_options_response.status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,OPTIONS,POST,PUT'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }
}

# API Gateway Deployment
resource "aws_api_gateway_deployment" "robinhood_deployment" {
  depends_on = [
    aws_api_gateway_integration.robinhood_integration,
    aws_api_gateway_integration.robinhood_options_integration,
  ]

  rest_api_id = aws_api_gateway_rest_api.robinhood_api.id

  triggers = {
    redeployment = sha1(jsonencode([
      aws_api_gateway_resource.robinhood_resource.id,
      aws_api_gateway_method.robinhood_method.id,
      aws_api_gateway_integration.robinhood_integration.id,
    ]))
  }

  lifecycle {
    create_before_destroy = true
  }
}

# API Gateway Stage
resource "aws_api_gateway_stage" "robinhood_stage" {
  deployment_id = aws_api_gateway_deployment.robinhood_deployment.id
  rest_api_id   = aws_api_gateway_rest_api.robinhood_api.id
  stage_name    = var.environment

  tags = merge(var.common_tags, {
    Name = "Cosine API Stage"
  })
}

# Lambda Permission for API Gateway
resource "aws_lambda_permission" "robinhood_api_gateway" {
  statement_id  = "AllowExecutionFromAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.robinhood_integration.function_name
  principal     = "apigateway.amazonaws.com"

  source_arn = "${aws_api_gateway_rest_api.robinhood_api.execution_arn}/*/*"
}

# Data sources
data "aws_region" "current" {}
data "aws_caller_identity" "current" {}
