# Data Sources for Base Infrastructure Integration
# This file contains data sources to automatically discover base infrastructure resources
# making the configuration portable across environments using naming conventions

# Data source to find Cognito User Pool by environment-specific naming convention
data "aws_cognito_user_pools" "main" {
  name = "${var.project_name}-user-pool-${var.environment}"
}

# Data source to get User Pool details once we find it
data "aws_cognito_user_pool" "main" {
  count        = length(data.aws_cognito_user_pools.main.ids) > 0 ? 1 : 0
  user_pool_id = data.aws_cognito_user_pools.main.ids[0]
}

# Data source to find User Pool Clients for the discovered user pool
data "aws_cognito_user_pool_clients" "main" {
  count        = length(data.aws_cognito_user_pools.main.ids) > 0 ? 1 : 0
  user_pool_id = data.aws_cognito_user_pools.main.ids[0]
}

# Data source to find DynamoDB tables by naming convention
data "aws_dynamodb_table" "user_profiles" {
  name = "${var.project_name}-user-profiles-${var.environment}"
}

data "aws_dynamodb_table" "security_events" {
  name = "${var.project_name}-security-events-${var.environment}"
}

data "aws_dynamodb_table" "user_sessions" {
  name = "${var.project_name}-user-sessions-${var.environment}"
}

# Local values for computed configurations using data sources
locals {
  # Check if we found the user pool via data sources
  user_pool_found = length(data.aws_cognito_user_pools.main.ids) > 0
  client_found    = local.user_pool_found && length(data.aws_cognito_user_pool_clients.main) > 0 && length(data.aws_cognito_user_pool_clients.main[0].client_ids) > 0

  # Authentication configuration with fallback priority:
  # 1. Terraform remote state (if available)
  # 2. Data source discovery (if resources exist)
  # 3. Variable fallback
  auth_config = {
    user_pool_id = try(
      data.terraform_remote_state.base_infra.outputs.cognito_user_pool_id,
      local.user_pool_found ? data.aws_cognito_user_pools.main.ids[0] : var.cognito_user_pool_id,
      var.cognito_user_pool_id
    )

    client_id = try(
      data.terraform_remote_state.base_infra.outputs.cognito_user_pool_client_id,
      local.client_found ? data.aws_cognito_user_pool_clients.main[0].client_ids[0] : var.cognito_client_id,
      var.cognito_client_id
    )

    # Domain name - construct from naming convention
    domain_name = try(
      data.terraform_remote_state.base_infra.outputs.cognito_user_pool_domain,
      "${var.project_name}-auth-${var.environment}"
    )

    # Full domain URL - construct the complete Cognito domain
    full_domain_url = try(
      data.terraform_remote_state.base_infra.outputs.frontend_auth_config.full_domain_url,
      "${var.project_name}-auth-${var.environment}.auth.${var.aws_region}.amazoncognito.com"
    )

    # Add environment for reference
    environment = var.environment
  }

  # Database configuration with similar fallback strategy
  database_config = {
    user_profiles_table_name = try(
      data.terraform_remote_state.base_infra.outputs.user_profiles_table_name,
      data.aws_dynamodb_table.user_profiles.name,
      "${var.project_name}-user-profiles-${var.environment}"
    )

    security_events_table_name = try(
      data.terraform_remote_state.base_infra.outputs.security_events_table_name,
      data.aws_dynamodb_table.security_events.name,
      "${var.project_name}-security-events-${var.environment}"
    )

    user_sessions_table_name = try(
      data.terraform_remote_state.base_infra.outputs.user_sessions_table_name,
      data.aws_dynamodb_table.user_sessions.name,
      "${var.project_name}-user-sessions-${var.environment}"
    )

    # Add environment for reference
    environment = var.environment
  }

  # Resource discovery status for debugging
  discovery_status = {
    user_pool_found        = local.user_pool_found
    client_found           = local.client_found
    user_profiles_exists   = can(data.aws_dynamodb_table.user_profiles.name)
    security_events_exists = can(data.aws_dynamodb_table.security_events.name)
    user_sessions_exists   = can(data.aws_dynamodb_table.user_sessions.name)
    remote_state_available = can(data.terraform_remote_state.base_infra.outputs)
  }
}
