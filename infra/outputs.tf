output "bucket_name" {
  description = "Private bucket to upload the contents of dist/ into."
  value       = aws_s3_bucket.site.id
}

output "distribution_id" {
  description = "CloudFront distribution ID for cache invalidation."
  value       = aws_cloudfront_distribution.site.id
}

output "site_url" {
  description = "Public HTTPS URL of the SPA."
  value       = "https://${aws_cloudfront_distribution.site.domain_name}"
}

output "s3_origin_url" {
  description = "Direct origin URL; anonymous requests should be denied."
  value       = "https://${aws_s3_bucket.site.bucket_regional_domain_name}"
}
