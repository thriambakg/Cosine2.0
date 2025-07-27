# modules/cloudfront/main.tf
# CloudFront distribution module with S3 origin

locals {
  distribution_name = "${var.project_name}-cloudfront-${var.environment}"
  oac_name          = "${var.project_name}-oac-${var.environment}"
}

# Origin Access Control for S3
resource "aws_cloudfront_origin_access_control" "s3_oac" {
  name                              = local.oac_name
  description                       = "OAC for ${var.project_name} S3 bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# CloudFront Distribution
resource "aws_cloudfront_distribution" "distribution" {
  enabled             = true
  is_ipv6_enabled     = var.enable_ipv6
  default_root_object = var.default_root_object
  price_class         = var.price_class
  aliases             = var.aliases

  # S3 Origin Configuration
  origin {
    domain_name              = var.s3_bucket_domain_name
    origin_id                = var.default_cache_behavior_settings.target_origin_id
    origin_access_control_id = aws_cloudfront_origin_access_control.s3_oac.id

    # Remove any existing origin_access_identity if migrating from OAI
  }

  # Default Cache Behavior
  default_cache_behavior {
    allowed_methods          = var.default_cache_behavior_settings.allowed_methods
    cached_methods           = var.default_cache_behavior_settings.cached_methods
    target_origin_id         = var.default_cache_behavior_settings.target_origin_id
    compress                 = var.default_cache_behavior_settings.compress
    viewer_protocol_policy   = var.default_cache_behavior_settings.viewer_protocol_policy
    cache_policy_id          = aws_cloudfront_cache_policy.default.id
    origin_request_policy_id = aws_cloudfront_origin_request_policy.default.id

    min_ttl     = var.default_cache_behavior_settings.min_ttl
    default_ttl = var.default_cache_behavior_settings.default_ttl
    max_ttl     = var.default_cache_behavior_settings.max_ttl
  }

  # Ordered Cache Behaviors
  dynamic "ordered_cache_behavior" {
    for_each = var.ordered_cache_behaviors
    content {
      path_pattern           = ordered_cache_behavior.value.path_pattern
      allowed_methods        = ordered_cache_behavior.value.allowed_methods
      cached_methods         = ordered_cache_behavior.value.cached_methods
      target_origin_id       = ordered_cache_behavior.value.target_origin_id
      compress               = ordered_cache_behavior.value.compress
      viewer_protocol_policy = ordered_cache_behavior.value.viewer_protocol_policy

      min_ttl     = ordered_cache_behavior.value.min_ttl
      default_ttl = ordered_cache_behavior.value.default_ttl
      max_ttl     = ordered_cache_behavior.value.max_ttl

      forwarded_values {
        query_string = ordered_cache_behavior.value.query_string
        headers      = ordered_cache_behavior.value.headers

        cookies {
          forward = ordered_cache_behavior.value.cookies_forward
        }
      }
    }
  }

  # Custom Error Responses (for SPA routing)
  dynamic "custom_error_response" {
    for_each = var.custom_error_responses
    content {
      error_code            = custom_error_response.value.error_code
      response_code         = custom_error_response.value.response_code
      response_page_path    = custom_error_response.value.response_page_path
      error_caching_min_ttl = custom_error_response.value.error_caching_min_ttl
    }
  }

  # Geographic Restrictions
  restrictions {
    geo_restriction {
      restriction_type = var.geo_restriction_type
      locations        = var.geo_restriction_locations
    }
  }

  # SSL Certificate Configuration
  viewer_certificate {
    acm_certificate_arn            = var.acm_certificate_arn
    ssl_support_method             = var.acm_certificate_arn != null ? "sni-only" : null
    minimum_protocol_version       = var.acm_certificate_arn != null ? "TLSv1.2_2021" : null
    cloudfront_default_certificate = var.acm_certificate_arn == null ? true : null
  }

  # Logging Configuration
  dynamic "logging_config" {
    for_each = var.enable_logging && var.logging_bucket != null ? [1] : []
    content {
      bucket          = var.logging_bucket
      prefix          = var.logging_prefix
      include_cookies = false
    }
  }

  tags = merge(var.tags, {
    Name        = local.distribution_name
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "Terraform"
  })

  # Wait for the OAC to be created
  depends_on = [aws_cloudfront_origin_access_control.s3_oac]
}

# Cache Policy for optimized caching
resource "aws_cloudfront_cache_policy" "default" {
  name        = "${var.project_name}-cache-policy-${var.environment}"
  comment     = "Cache policy for ${var.project_name}"
  default_ttl = var.default_cache_behavior_settings.default_ttl
  max_ttl     = var.default_cache_behavior_settings.max_ttl
  min_ttl     = var.default_cache_behavior_settings.min_ttl

  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_brotli = true
    enable_accept_encoding_gzip   = true

    headers_config {
      header_behavior = "none"
    }

    query_strings_config {
      query_string_behavior = "none"
    }

    cookies_config {
      cookie_behavior = "none"
    }
  }
}

# Origin Request Policy
resource "aws_cloudfront_origin_request_policy" "default" {
  name    = "${var.project_name}-origin-request-policy-${var.environment}"
  comment = "Origin request policy for ${var.project_name}"

  headers_config {
    header_behavior = "whitelist"
    headers {
      items = ["Origin", "Access-Control-Request-Method", "Access-Control-Request-Headers"]
    }
  }

  query_strings_config {
    query_string_behavior = "none"
  }

  cookies_config {
    cookie_behavior = "none"
  }
}

# S3 Bucket Policy for CloudFront OAC
resource "aws_s3_bucket_policy" "cloudfront_oac_policy" {
  bucket = var.s3_bucket_id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowCloudFrontServicePrincipal"
        Effect = "Allow"
        Principal = {
          Service = "cloudfront.amazonaws.com"
        }
        Action   = "s3:GetObject"
        Resource = "${var.s3_bucket_arn}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.distribution.arn
          }
        }
      }
    ]
  })

  depends_on = [aws_cloudfront_distribution.distribution]
}
