# Fix ALB Health Check Settings
param(
    [Parameter(Mandatory=$false)]
    [string]$Environment = "staging"
)

$Region = "us-east-1"
$TargetGroupArn = "arn:aws:elasticloadbalancing:us-east-1:676206904242:targetgroup/cosine-frontend-tg-v2-staging/0515690455f49cbd"

Write-Host "Fixing ALB Health Check Settings for Environment: $Environment" -ForegroundColor Cyan
Write-Host ""

Write-Host "Current Health Check Settings:" -ForegroundColor Yellow
aws elbv2 describe-target-groups --target-group-arns $TargetGroupArn --query "TargetGroups[0].{HealthCheckIntervalSeconds:HealthCheckIntervalSeconds,HealthCheckTimeoutSeconds:HealthCheckTimeoutSeconds,HealthyThresholdCount:HealthyThresholdCount,UnhealthyThresholdCount:UnhealthyThresholdCount}" --output table --region $Region

Write-Host ""
Write-Host "Updating Health Check Settings..." -ForegroundColor Green

# Update health check settings to be more tolerant for Next.js
aws elbv2 modify-target-group --target-group-arn $TargetGroupArn --health-check-interval-seconds 30 --health-check-timeout-seconds 20 --healthy-threshold-count 2 --unhealthy-threshold-count 3 --region $Region

Write-Host ""
Write-Host "New Health Check Settings:" -ForegroundColor Green
aws elbv2 describe-target-groups --target-group-arns $TargetGroupArn --query "TargetGroups[0].{HealthCheckIntervalSeconds:HealthCheckIntervalSeconds,HealthCheckTimeoutSeconds:HealthCheckTimeoutSeconds,HealthyThresholdCount:HealthyThresholdCount,UnhealthyThresholdCount:UnhealthyThresholdCount}" --output table --region $Region

Write-Host ""
Write-Host "Changes Applied:" -ForegroundColor Cyan
Write-Host "- Health check interval: 15s -> 30s (more time between checks)" -ForegroundColor White
Write-Host "- Health check timeout: 10s -> 20s (more time for Next.js to respond)" -ForegroundColor White
Write-Host "- Unhealthy threshold: 5 -> 3 (faster detection but more tolerant)" -ForegroundColor White
Write-Host ""
Write-Host "Expected Result:" -ForegroundColor Green
Write-Host "- Total time to mark unhealthy: 3 failures * 30s = 90 seconds" -ForegroundColor White
Write-Host "- Total time to mark healthy: 2 successes * 30s = 60 seconds" -ForegroundColor White
Write-Host ""
Write-Host "Monitor your targets - they should become healthy in ~2-3 minutes!" -ForegroundColor Yellow
