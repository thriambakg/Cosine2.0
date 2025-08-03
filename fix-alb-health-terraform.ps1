# Fix ALB Health Check Settings - Terraform Synchronized
param(
    [Parameter(Mandatory=$false)]
    [string]$Environment = "staging"
)

$Region = "us-east-1"
$TargetGroupArn = "arn:aws:elasticloadbalancing:us-east-1:676206904242:targetgroup/cosine-frontend-tg-v2-staging/0515690455f49cbd"

Write-Host "Fixing ALB Health Check Settings for Environment: $Environment" -ForegroundColor Cyan
Write-Host "This applies the same settings as defined in terraform/modules/alb/main.tf" -ForegroundColor Gray
Write-Host ""

Write-Host "Current Health Check Settings:" -ForegroundColor Yellow
aws elbv2 describe-target-groups --target-group-arns $TargetGroupArn --query "TargetGroups[0].{HealthCheckIntervalSeconds:HealthCheckIntervalSeconds,HealthCheckTimeoutSeconds:HealthCheckTimeoutSeconds,HealthyThresholdCount:HealthyThresholdCount,UnhealthyThresholdCount:UnhealthyThresholdCount}" --output table --region $Region

Write-Host ""
Write-Host "Applying optimized health check settings for Next.js applications..." -ForegroundColor Green

# Update health check settings to match Terraform configuration
aws elbv2 modify-target-group --target-group-arn $TargetGroupArn --health-check-interval-seconds 30 --health-check-timeout-seconds 20 --healthy-threshold-count 2 --unhealthy-threshold-count 3 --region $Region

if ($LASTEXITCODE -eq 0) {
    Write-Host "Health check settings updated successfully!" -ForegroundColor Green
} else {
    Write-Host "Failed to update health check settings" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "New Health Check Settings:" -ForegroundColor Green
aws elbv2 describe-target-groups --target-group-arns $TargetGroupArn --query "TargetGroups[0].{HealthCheckIntervalSeconds:HealthCheckIntervalSeconds,HealthCheckTimeoutSeconds:HealthCheckTimeoutSeconds,HealthyThresholdCount:HealthyThresholdCount,UnhealthyThresholdCount:UnhealthyThresholdCount}" --output table --region $Region

Write-Host ""
Write-Host "Changes Applied (matching terraform/modules/alb/main.tf):" -ForegroundColor Cyan
Write-Host "- Health check interval: 15s -> 30s (more time between checks)" -ForegroundColor White
Write-Host "- Health check timeout: 10s -> 20s (more time for Next.js to respond)" -ForegroundColor White
Write-Host "- Unhealthy threshold: 5 -> 3 (faster detection, more tolerant)" -ForegroundColor White
Write-Host "- Healthy threshold: 2 (unchanged - need 2 successes)" -ForegroundColor White

Write-Host ""
Write-Host "Expected Timings:" -ForegroundColor Yellow
Write-Host "- Time to mark unhealthy: 3 failures x 30s = 90 seconds" -ForegroundColor White
Write-Host "- Time to mark healthy: 2 successes x 30s = 60 seconds" -ForegroundColor White

Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Green
Write-Host "1. Monitor target health: containers should become healthy in 2-3 minutes" -ForegroundColor White
Write-Host "2. Run terraform plan to verify changes match infrastructure" -ForegroundColor White
Write-Host "3. Run terraform apply to ensure configuration is persisted" -ForegroundColor White

Write-Host ""
Write-Host "Monitor with: .\diagnose-ecs-health-simple.ps1" -ForegroundColor Cyan
