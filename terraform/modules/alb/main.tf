# Application Load Balancer Module with Security
# modules/alb/main.tf

# Data sources
data "aws_region" "current" {}
data "aws_caller_identity" "current" {}
data "aws_vpc" "main" {
  id = var.vpc_id
}

# Self-signed certificate for staging environment (when no custom domain)
# This ensures HTTPS is always available and resolves security scanner warnings
resource "tls_private_key" "default" {
  count     = var.certificate_arn == "" ? 1 : 0
  algorithm = "RSA"
  rsa_bits  = 2048
}

resource "tls_self_signed_cert" "default" {
  count           = var.certificate_arn == "" ? 1 : 0
  private_key_pem = tls_private_key.default[0].private_key_pem

  subject {
    common_name  = "localhost"
    organization = var.project_name
  }

  validity_period_hours = 8760 # 1 year

  allowed_uses = [
    "key_encipherment",
    "digital_signature",
    "server_auth",
  ]
}

resource "aws_acm_certificate" "default" {
  count            = var.certificate_arn == "" ? 1 : 0
  private_key      = tls_private_key.default[0].private_key_pem
  certificate_body = tls_self_signed_cert.default[0].cert_pem

  tags = merge(var.tags, {
    Name = "${var.project_name}-default-cert-${var.environment}"
  })

  lifecycle {
    create_before_destroy = true
  }
}

# Try to find existing security group first
data "aws_security_groups" "existing_alb_sg" {
  filter {
    name   = "group-name"
    values = ["${var.project_name}-alb-${var.environment}"]
  }
  filter {
    name   = "vpc-id"
    values = [var.vpc_id]
  }
}

# Security Group for ALB - use fixed name for stability (v2 to force recreation without inline rules)
resource "aws_security_group" "alb" {
  name        = "${var.project_name}-alb-sg-v2-${var.environment}"
  description = "Security group for Application Load Balancer"
  vpc_id      = var.vpc_id

  # No inline rules - managed separately as aws_security_group_rule resources
  # Explicitly empty to ensure no conflicts with separate rules
  ingress = []
  egress  = []

  tags = merge(var.tags, {
    Name = "${var.project_name}-alb-sg-${var.environment}"
  })

  lifecycle {
    create_before_destroy = true
    ignore_changes        = [tags["Environment"], tags["Repository"]]
    # Do not ignore ingress/egress changes - we want them to stay empty
  }
}

# Local value to ensure we use the correct security group ID
locals {
  security_group_id = aws_security_group.alb.id
}

# Security Group Rules (managed separately for better lifecycle control)
resource "aws_security_group_rule" "alb_http_ingress" {
  type              = "ingress"
  from_port         = 80
  to_port           = 80
  protocol          = "tcp"
  cidr_blocks       = ["0.0.0.0/0"]
  description       = "Allow HTTP traffic"
  security_group_id = local.security_group_id

  lifecycle {
    create_before_destroy = true
  }

  depends_on = [aws_security_group.alb]
}

resource "aws_security_group_rule" "alb_https_ingress" {
  type              = "ingress"
  from_port         = 443
  to_port           = 443
  protocol          = "tcp"
  cidr_blocks       = ["0.0.0.0/0"]
  description       = "Allow HTTPS traffic"
  security_group_id = local.security_group_id

  lifecycle {
    create_before_destroy = true
  }

  depends_on = [aws_security_group.alb]
}

resource "aws_security_group_rule" "alb_egress_to_targets" {
  type              = "egress"
  from_port         = 3000
  to_port           = 3000
  protocol          = "tcp"
  cidr_blocks       = [data.aws_vpc.main.cidr_block]
  description       = "Allow ALB to communicate with ECS targets on port 3000"
  security_group_id = local.security_group_id

  lifecycle {
    create_before_destroy = true
  }

  depends_on = [aws_security_group.alb]
}

# Application Load Balancer
# tfsec:ignore:aws-elb-alb-not-public - Public ALB is intentional for web frontend
resource "aws_lb" "main" {
  name               = "${var.project_name}-alb-v2-${var.environment}"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [local.security_group_id]
  subnets            = var.public_subnet_ids

  enable_deletion_protection = var.enable_deletion_protection

  # Access logs
  access_logs {
    bucket  = var.access_logs_bucket
    prefix  = "alb-access-logs"
    enabled = var.enable_access_logs
  }

  # Drop invalid header fields for security
  drop_invalid_header_fields = true

  # Ensure security group and all rules are created first
  depends_on = [
    aws_security_group.alb,
    aws_security_group_rule.alb_http_ingress,
    aws_security_group_rule.alb_https_ingress,
    aws_security_group_rule.alb_egress_to_targets
  ]

  lifecycle {
    ignore_changes = [tags["Environment"], tags["Repository"]]
    # Prevent destruction if ALB is being used
    prevent_destroy = false
    # Create new ALB before destroying old one when name_prefix changes
    create_before_destroy = true
  }

  tags = merge(var.tags, {
    Name = "${var.project_name}-alb-${var.environment}"
  })
}

# Target Group for Frontend
resource "aws_lb_target_group" "frontend" {
  name        = "${var.project_name}-frontend-tg-v2-${var.environment}"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    enabled             = true
    healthy_threshold   = 2
    interval            = 30
    matcher             = "200"
    path                = "/api/health"
    port                = "traffic-port"
    protocol            = "HTTP"
    timeout             = 5
    unhealthy_threshold = 2
  }

  # Deregistration delay
  deregistration_delay = 30

  lifecycle {
    ignore_changes = [tags["Environment"], tags["Repository"]]
  }

  tags = merge(var.tags, {
    Name = "${var.project_name}-frontend-tg-${var.environment}"
  })
}

# Development warning for missing certificate
resource "null_resource" "certificate_warning" {
  count = var.enable_https == false ? 1 : 0

  provisioner "local-exec" {
    command = <<-EOT
      echo "WARNING: No SSL certificate provided. ALB will be created without HTTPS listener."
      echo "For production, provide certificate_arn or set enable_custom_domain = true"
      echo "Security scanners may flag this as HTTP traffic serving."
    EOT
  }
}

# HTTPS Listener (Primary) - Always created for security compliance
resource "aws_lb_listener" "https" {
  count = 1 # Always create HTTPS listener

  load_balancer_arn = aws_lb.main.arn
  port              = "443"
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS-1-2-2017-01"

  # Use provided certificate if available, otherwise use self-signed certificate
  certificate_arn = var.certificate_arn != "" ? var.certificate_arn : aws_acm_certificate.default[0].arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.frontend.arn
  }
}

# HTTP Listener - Always redirect to HTTPS for security
resource "aws_lb_listener" "http" {
  count = 1 # Always create HTTP redirect

  load_balancer_arn = aws_lb.main.arn
  port              = "80"
  protocol          = "HTTP"

  default_action {
    type = "redirect"

    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

# WAF Web ACL for DDoS and SQL Injection Protection
resource "aws_wafv2_web_acl" "main" {
  name  = "${var.project_name}-waf-${var.environment}"
  scope = "REGIONAL"

  default_action {
    allow {}
  }

  # Rate limiting rule
  rule {
    name     = "RateLimitRule"
    priority = 1

    statement {
      rate_based_statement {
        limit                 = var.rate_limit
        aggregate_key_type    = "IP"
        evaluation_window_sec = 300
      }
    }

    action {
      block {}
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "RateLimitRule"
      sampled_requests_enabled   = true
    }
  }

  # AWS Managed Rules - Core Rule Set
  rule {
    name     = "AWSManagedRulesCommonRuleSet"
    priority = 2

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "CommonRuleSetMetric"
      sampled_requests_enabled   = true
    }
  }

  # AWS Managed Rules - SQL Injection
  rule {
    name     = "AWSManagedRulesSQLiRuleSet"
    priority = 3

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesSQLiRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "SQLiRuleSetMetric"
      sampled_requests_enabled   = true
    }
  }

  # AWS Managed Rules - IP Reputation
  rule {
    name     = "AWSManagedRulesAmazonIpReputationList"
    priority = 4

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesAmazonIpReputationList"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "IpReputationMetric"
      sampled_requests_enabled   = true
    }
  }

  # AWS Managed Rules - Known Bad Inputs
  rule {
    name     = "AWSManagedRulesKnownBadInputsRuleSet"
    priority = 5

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "KnownBadInputsMetric"
      sampled_requests_enabled   = true
    }
  }

  # Geographic blocking (optional)
  dynamic "rule" {
    for_each = length(var.blocked_countries) > 0 ? [1] : []
    content {
      name     = "GeoBlockRule"
      priority = 6

      action {
        block {}
      }

      statement {
        geo_match_statement {
          country_codes = var.blocked_countries
        }
      }

      visibility_config {
        cloudwatch_metrics_enabled = true
        metric_name                = "GeoBlockMetric"
        sampled_requests_enabled   = true
      }
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.project_name}WAF${var.environment}"
    sampled_requests_enabled   = true
  }

  tags = merge(var.tags, {
    Name = "${var.project_name}-waf-${var.environment}"
  })
}

# Associate WAF with ALB
resource "aws_wafv2_web_acl_association" "main" {
  resource_arn = aws_lb.main.arn
  web_acl_arn  = aws_wafv2_web_acl.main.arn
}

# Null resource to ensure ALB is fully ready before ECS service creation (always HTTPS)
resource "null_resource" "alb_ready_with_https" {
  count = 1 # Always create since we always have HTTPS

  depends_on = [
    aws_lb.main,
    aws_lb_target_group.frontend,
    aws_lb_listener.http[0],
    aws_lb_listener.https[0]
  ]
}

# CloudWatch Log Group for WAF
resource "aws_cloudwatch_log_group" "waf" {
  count             = var.enable_waf_logging ? 1 : 0
  name              = "/aws/wafv2/${var.project_name}-${var.environment}"
  retention_in_days = 30
  kms_key_id        = var.kms_key_arn

  tags = merge(var.tags, {
    Name = "${var.project_name}-waf-logs-${var.environment}"
  })
}

# CloudWatch Log Group Resource Policy for WAF
resource "aws_cloudwatch_log_resource_policy" "waf" {
  count       = var.enable_waf_logging ? 1 : 0
  policy_name = "${var.project_name}-waf-logs-policy-${var.environment}"

  policy_document = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "wafv2.amazonaws.com"
        }
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:log-group:/aws/wafv2/${var.project_name}-${var.environment}:*"
        Condition = {
          StringEquals = {
            "aws:SourceAccount" = data.aws_caller_identity.current.account_id
          }
        }
      }
    ]
  })
}

# WAF Logging Configuration
resource "aws_wafv2_web_acl_logging_configuration" "main" {
  count        = var.enable_waf_logging ? 1 : 0
  resource_arn = aws_wafv2_web_acl.main.arn
  log_destination_configs = [
    "arn:aws:logs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:log-group:/aws/wafv2/${var.project_name}-${var.environment}"
  ]

  depends_on = [
    aws_cloudwatch_log_group.waf,
    aws_cloudwatch_log_resource_policy.waf
  ]

  redacted_fields {
    single_header {
      name = "authorization"
    }
  }

  redacted_fields {
    single_header {
      name = "cookie"
    }
  }
}

