# Billing and Usage Tracking Module
# This module creates DynamoDB tables for tracking user usage and billing

resource "aws_dynamodb_table" "user_usage" {
  name         = "${var.project_name}-user-usage-${var.environment}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "user_id"
  range_key    = "usage_id"

  attribute {
    name = "user_id"
    type = "S"
  }

  attribute {
    name = "usage_id"
    type = "S"
  }

  attribute {
    name = "timestamp"
    type = "N"
  }

  attribute {
    name = "service_type"
    type = "S"
  }

  # GSI for querying by timestamp
  global_secondary_index {
    name      = "TimestampIndex"
    hash_key  = "user_id"
    range_key = "timestamp"
  }

  # GSI for querying by service type
  global_secondary_index {
    name      = "ServiceTypeIndex"
    hash_key  = "service_type"
    range_key = "timestamp"
  }

  ttl {
    attribute_name = "expires_at"
    enabled        = true
  }

  tags = var.common_tags
}

resource "aws_dynamodb_table" "user_credits" {
  name         = "${var.project_name}-user-credits-${var.environment}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "user_id"

  attribute {
    name = "user_id"
    type = "S"
  }

  tags = var.common_tags
}

resource "aws_dynamodb_table" "billing_transactions" {
  name         = "${var.project_name}-billing-transactions-${var.environment}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "transaction_id"

  attribute {
    name = "transaction_id"
    type = "S"
  }

  attribute {
    name = "user_id"
    type = "S"
  }

  attribute {
    name = "timestamp"
    type = "N"
  }

  # GSI for querying by user
  global_secondary_index {
    name      = "UserIndex"
    hash_key  = "user_id"
    range_key = "timestamp"
  }

  ttl {
    attribute_name = "expires_at"
    enabled        = true
  }

  tags = var.common_tags
}
