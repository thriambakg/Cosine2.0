# =============================================================================
# DOMAIN MODULE OUTPUTS
# Outputs for custom domain configuration and SSL certificate information
# =============================================================================

output "hosted_zone_id" {
  description = "Route53 hosted zone ID"
  value       = var.enable_custom_domain ? aws_route53_zone.main[0].zone_id : null
}

output "hosted_zone_name_servers" {
  description = "Route53 hosted zone name servers"
  value       = var.enable_custom_domain ? aws_route53_zone.main[0].name_servers : []
}

output "certificate_arn" {
  description = "ARN of the ACM certificate"
  value       = var.enable_custom_domain ? aws_acm_certificate_validation.main[0].certificate_arn : null
}

output "domain_name" {
  description = "Full domain name for the application"
  value       = var.enable_custom_domain ? (var.subdomain != "" ? "${var.subdomain}.${var.domain_name}" : var.domain_name) : null
}

output "website_url" {
  description = "Complete URL for the website"
  value       = var.enable_custom_domain ? "https://${var.subdomain != "" ? "${var.subdomain}.${var.domain_name}" : var.domain_name}" : null
}
