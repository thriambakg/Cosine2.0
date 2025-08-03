# ECS Health Diagnosis Script - Fixed Version
param(
    [Parameter(Mandatory=$false)]
    [string]$Environment = "staging"
)

$ErrorActionPreference = "Continue"
$Region = "us-east-1"
$ClusterName = "cosine-cluster-$Environment"
$ServiceName = "cosine-frontend-service-$Environment"

Write-Host "Diagnosing ECS Health for Environment: $Environment" -ForegroundColor Cyan
Write-Host "Region: $Region" -ForegroundColor Gray
Write-Host "Cluster: $ClusterName" -ForegroundColor Gray
Write-Host "Service: $ServiceName" -ForegroundColor Gray
Write-Host ""

# Check ECS Service
Write-Host "ECS Service Details:" -ForegroundColor Yellow
aws ecs describe-services --cluster $ClusterName --services $ServiceName --region $Region --query "services[0].{serviceName:serviceName,status:status,runningCount:runningCount,desiredCount:desiredCount,pendingCount:pendingCount}" --output table

Write-Host ""

# Get task details
Write-Host "ECS Task Details:" -ForegroundColor Yellow
$taskArns = aws ecs list-tasks --cluster $ClusterName --service-name $ServiceName --query "taskArns" --output text --region $Region

if ($taskArns -and $taskArns -ne "None") {
    Write-Host "Task ARNs: $taskArns" -ForegroundColor Gray
    aws ecs describe-tasks --cluster $ClusterName --tasks $taskArns --query "tasks[].{taskArn:taskArn,lastStatus:lastStatus,healthStatus:healthStatus,containers:containers[0].{name:name,lastStatus:lastStatus,healthStatus:healthStatus,reason:reason}}" --output table --region $Region
} else {
    Write-Host "No tasks found for service $ServiceName" -ForegroundColor Red
}

Write-Host ""

# Check Target Group Health
Write-Host "ALB Target Group Health:" -ForegroundColor Yellow
$targetGroupArn = aws ecs describe-services --cluster $ClusterName --services $ServiceName --query "services[0].loadBalancers[0].targetGroupArn" --output text --region $Region

if ($targetGroupArn -and $targetGroupArn -ne "None") {
    Write-Host "Target Group ARN: $targetGroupArn" -ForegroundColor Gray
    
    Write-Host ""
    Write-Host "Target Health Status:" -ForegroundColor Green
    aws elbv2 describe-target-health --target-group-arn $targetGroupArn --query "TargetHealthDescriptions[].{Target:Target.Id,Port:Target.Port,Health:TargetHealth.State,Reason:TargetHealth.Reason,Description:TargetHealth.Description}" --output table --region $Region
    
    Write-Host ""
    Write-Host "Target Group Configuration:" -ForegroundColor Green
    aws elbv2 describe-target-groups --target-group-arns $targetGroupArn --query "TargetGroups[0].{Name:TargetGroupName,Protocol:Protocol,Port:Port,HealthCheckPath:HealthCheckPath,HealthCheckPort:HealthCheckPort,HealthCheckProtocol:HealthCheckProtocol}" --output table --region $Region
} else {
    Write-Host "No target group found for service" -ForegroundColor Red
}

Write-Host ""
Write-Host "Diagnosis Complete!" -ForegroundColor Green
