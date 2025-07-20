# modules/cloudfront/outputs.tf
# Output values from the CloudFront module

output "distribution_id" {
  description = "ID of the CloudFront distribution"
  value       = aws_cloudfront_distribution.distribution.id
}

output "distribution_arn" {
  description = "ARN of the CloudFront distribution"
  value       = aws_cloudfront_distribution.distribution.arn
}

output "distribution_domain_name" {
  description = "Domain name of the CloudFront distribution"
  value       = aws_cloudfront_distribution.distribution.domain_name
}

output "distribution_hosted_zone_id" {
  description = "CloudFront Route 53 zone ID"
  value       = aws_cloudfront_distribution.distribution.hosted_zone_id
}

output "distribution_status" {
  description = "Current status of the distribution"
  value       = aws_cloudfront_distribution.distribution.status
}

output "origin_access_control_id" {
  description = "ID of the Origin Access Control"
  value       = aws_cloudfront_origin_access_control.s3_oac.id
}

output "cache_policy_id" {
  description = "ID of the cache policy"
  value       = aws_cloudfront_cache_policy.default.id
}

output "origin_request_policy_id" {
  description = "ID of the origin request policy"
  value       = aws_cloudfront_origin_request_policy.default.id
}

output "distribution_etag" {
  description = "Current version of the distribution's information"
  value       = aws_cloudfront_distribution.distribution.etag
}
