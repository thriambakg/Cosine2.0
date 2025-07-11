# Root variables.tf - This file is deprecated
# Please use the environment-specific configurations in:
# - infra/environments/staging/
# - infra/environments/production/
#
# This file is kept for backward compatibility but should not be used directly.

# NOTE: Variables are now managed through environment-specific folders.
# Each environment has its own variables.tf file with appropriate defaults.

# Deprecated variables - use environment-specific configurations instead
variable "deprecation_notice" {
  description = "This root configuration is deprecated. Use infra/environments/{staging,production}/ instead."
  type        = string
  default     = "DEPRECATED: Use environment-specific configurations"
}
