# Data Sources for Base Infrastructure Integration
# This file contains data sources to automatically discover base infrastructure resources
# making the configuration portable across environments

# Data source to find Cognito User Pool by environment-specific naming
data "aws_cognito_user_pools" "main" {
  name = "${var.project_name}-user-pool-${var.environment}"
}

# Data source to get User Pool details
data "aws_cognito_user_pool" "main" {
  count        = length(data.aws_cognito_user_pools.main.ids) > 0 ? 1 : 0
  user_pool_id = data.aws_cognito_user_pools.main.ids[0]
}

# Data source to find User Pool Clients
data "aws_cognito_user_pool_clients" "main" {
  count        = length(data.aws_cognito_user_pools.main.ids) > 0 ? 1 : 0
  user_pool_id = data.aws_cognito_user_pools.main.ids[0]
}

# Data source to get User Pool Domain
data "aws_cognito_user_pool_domain" "main" {
  count  = length(data.aws_cognito_user_pools.main.ids) > 0 ? 1 : 0
  domain = "${var.project_name}-auth-${var.environment}"
}

# Local values for computed configurations
locals {
  # Authentication configuration from data sources or remote state
  auth_config = {
    user_pool_id = try(
      data.terraform_remote_state.base_infra.outputs.cognito_user_pool_id,
      length(data.aws_cognito_user_pools.main.ids) > 0 ? data.aws_cognito_user_pools.main.ids[0] : var.cognito_user_pool_id,
      var.cognito_user_pool_id
    )

    client_id = try(
      data.terraform_remote_state.base_infra.outputs.cognito_user_pool_client_id,
      length(data.aws_cognito_user_pool_clients.main) > 0 && length(data.aws_cognito_user_pool_clients.main[0].client_ids) > 0 ? data.aws_cognito_user_pool_clients.main[0].client_ids[0] : var.cognito_client_id,
      var.cognito_client_id
    )

    domain_name = try(
      data.terraform_remote_state.base_infra.outputs.cognito_user_pool_domain,
      length(data.aws_cognito_user_pool_domain.main) > 0 ? data.aws_cognito_user_pool_domain.main[0].domain : "${var.project_name}-auth-${var.environment}",
      "${var.project_name}-auth-${var.environment}"
    )

    full_domain_url = try(
      data.terraform_remote_state.base_infra.outputs.frontend_auth_config.full_domain_url,
      length(data.aws_cognito_user_pool_domain.main) > 0 ? "${data.aws_cognito_user_pool_domain.main[0].domain}.auth.${var.aws_region}.amazoncognito.com" : "${var.project_name}-auth-${var.environment}.auth.${var.aws_region}.amazoncognito.com",
      "${var.project_name}-auth-${var.environment}.auth.${var.aws_region}.amazoncognito.com"
    )
  }

  # Database configuration from data sources or remote state
  database_config = {
    user_profiles_table_name = try(
      data.terraform_remote_state.base_infra.outputs.user_profiles_table_name,
      "${var.project_name}-user-profiles-${var.environment}"
    )

    security_events_table_name = try(
      data.terraform_remote_state.base_infra.outputs.security_events_table_name,
      "${var.project_name}-security-events-${var.environment}"
    )

    user_sessions_table_name = try(
      data.terraform_remote_state.base_infra.outputs.user_sessions_table_name,
      "${var.project_name}-user-sessions-${var.environment}"
    )
  }
}
