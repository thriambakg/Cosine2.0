# Root outputs.tf - This file is deprecated
# Please use the environment-specific configurations in:
# - infra/environments/staging/
# - infra/environments/production/
#
# This file is kept for backward compatibility but should not be used directly.

# NOTE: Outputs are now managed through environment-specific folders.
# Each environment has its own outputs.tf file that references module outputs.

# Deprecated - use environment-specific configurations instead
output "deprecation_notice" {
  description = "This root configuration is deprecated. Use infra/environments/{staging,production}/ instead."
  value       = "DEPRECATED: Use environment-specific configurations"
}
