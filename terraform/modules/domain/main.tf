# =============================================================================
# CUSTOM DOMAIN MODULE
# Configures Route53 hosted zone and SSL certificate for custom domain
# =============================================================================

# Route 53 Hosted Zone (if custom domain is enabled)
resource "aws_route53_zone" "main" {
  count = var.enable_custom_domain ? 1 : 0
  name  = var.domain_name

  tags = merge(var.common_tags, {
    Name = "${var.project_name}-${var.environment}-hosted-zone"
  })
}

# ACM Certificate for custom domain
resource "aws_acm_certificate" "main" {
  count                     = var.enable_custom_domain ? 1 : 0
  domain_name               = var.domain_name
  subject_alternative_names = ["*.${var.domain_name}"]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = merge(var.common_tags, {
    Name = "${var.project_name}-${var.environment}-certificate"
  })
}

# Certificate validation records
resource "aws_route53_record" "cert_validation" {
  for_each = var.enable_custom_domain ? {
    for dvo in aws_acm_certificate.main[0].domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  } : {}

  allow_overwrite = true
  name            = each.value.name
  records         = [each.value.record]
  ttl             = 60
  type            = each.value.type
  zone_id         = aws_route53_zone.main[0].zone_id
}

# Certificate validation
resource "aws_acm_certificate_validation" "main" {
  count                   = var.enable_custom_domain ? 1 : 0
  certificate_arn         = aws_acm_certificate.main[0].arn
  validation_record_fqdns = [for record in aws_route53_record.cert_validation : record.fqdn]
}

# A record pointing to ALB
resource "aws_route53_record" "frontend" {
  count   = var.enable_custom_domain ? 1 : 0
  zone_id = aws_route53_zone.main[0].zone_id
  name    = var.subdomain != "" ? "${var.subdomain}.${var.domain_name}" : var.domain_name
  type    = "A"

  alias {
    name                   = var.alb_dns_name
    zone_id                = var.alb_zone_id
    evaluate_target_health = true
  }
}

# CNAME record for www (if subdomain is not www)
resource "aws_route53_record" "www" {
  count   = var.enable_custom_domain && var.subdomain != "www" ? 1 : 0
  zone_id = aws_route53_zone.main[0].zone_id
  name    = "www.${var.domain_name}"
  type    = "CNAME"
  ttl     = 300
  records = [var.subdomain != "" ? "${var.subdomain}.${var.domain_name}" : var.domain_name]
}
