# ECS Health Diagnosis Script
# Run this script to diagnose ECS and ALB health issues

param(
    [Parameter(Mandatory=$false)]
    [string]$Environment = "staging"
)

$ErrorActionPreference = "Continue"
$Region = "us-east-1"
$ClusterName = "cosine-cluster-$Environment"
$ServiceName = "cosine-frontend-service-$Environment"

Write-Host "🔍 Diagnosing ECS Health for Environment: $Environment" -ForegroundColor Cyan
Write-Host "Region: $Region" -ForegroundColor Gray
Write-Host "Cluster: $ClusterName" -ForegroundColor Gray
Write-Host "Service: $ServiceName" -ForegroundColor Gray
Write-Host ""

# Check ECS Service
Write-Host "📋 ECS Service Details:" -ForegroundColor Yellow
try {
    aws ecs describe-services --cluster $ClusterName --services $ServiceName --region $Region --query 'services[0].{serviceName:serviceName,status:status,runningCount:runningCount,desiredCount:desiredCount,pendingCount:pendingCount}' --output table
} catch {
    Write-Host "❌ Failed to get ECS service details" -ForegroundColor Red
}

Write-Host ""

# Get task details
Write-Host "🏃 ECS Task Details:" -ForegroundColor Yellow
try {
    $taskArns = aws ecs list-tasks --cluster $ClusterName --service-name $ServiceName --query 'taskArns' --output text --region $Region
    
    if ($taskArns -and $taskArns -ne "None") {
        Write-Host "Task ARNs: $taskArns" -ForegroundColor Gray
        aws ecs describe-tasks --cluster $ClusterName --tasks $taskArns --query 'tasks[].{taskArn:taskArn,lastStatus:lastStatus,healthStatus:healthStatus,containers:containers[0].{name:name,lastStatus:lastStatus,healthStatus:healthStatus,reason:reason}}' --output table --region $Region
    } else {
        Write-Host "❌ No tasks found for service $ServiceName" -ForegroundColor Red
    }
} catch {
    Write-Host "❌ Failed to get task details" -ForegroundColor Red
}

Write-Host ""

# Check Target Group Health
Write-Host "🎯 ALB Target Group Health:" -ForegroundColor Yellow
try {
    $targetGroupArn = aws ecs describe-services --cluster $ClusterName --services $ServiceName --query 'services[0].loadBalancers[0].targetGroupArn' --output text --region $Region
    
    if ($targetGroupArn -and $targetGroupArn -ne "None") {
        Write-Host "Target Group ARN: $targetGroupArn" -ForegroundColor Gray
        
        Write-Host ""
        Write-Host "🏥 Target Health Status:" -ForegroundColor Green
        aws elbv2 describe-target-health --target-group-arn $targetGroupArn --query 'TargetHealthDescriptions[].{Target:Target.Id,Port:Target.Port,Health:TargetHealth.State,Reason:TargetHealth.Reason,Description:TargetHealth.Description}' --output table --region $Region
        
        Write-Host ""
        Write-Host "⚙️ Target Group Configuration:" -ForegroundColor Green
        aws elbv2 describe-target-group-attributes --target-group-arn $targetGroupArn --query 'Attributes[?Key==`health_check_path` || Key==`health_check_port` || Key==`health_check_protocol` || Key==`health_check_interval_seconds` || Key==`health_check_timeout_seconds` || Key==`healthy_threshold_count` || Key==`unhealthy_threshold_count`].{Key:Key,Value:Value}' --output table --region $Region
        
        Write-Host ""
        Write-Host "📊 Target Group Details:" -ForegroundColor Green
        aws elbv2 describe-target-groups --target-group-arns $targetGroupArn --query 'TargetGroups[0].{Name:TargetGroupName,Protocol:Protocol,Port:Port,HealthCheckPath:HealthCheckPath,HealthCheckPort:HealthCheckPort,HealthCheckProtocol:HealthCheckProtocol}' --output table --region $Region
    } else {
        Write-Host "❌ No target group found for service" -ForegroundColor Red
    }
} catch {
    Write-Host "❌ Failed to get target group details" -ForegroundColor Red
}

Write-Host ""

# Check Security Groups
Write-Host "🛡️ Security Group Analysis:" -ForegroundColor Yellow
try {
    if ($taskArns -and $taskArns -ne "None") {
        $securityGroups = aws ecs describe-tasks --cluster $ClusterName --tasks $taskArns --query 'tasks[0].attachments[0].details[?name==`securityGroupId`].value' --output text --region $Region
        
        if ($securityGroups) {
            Write-Host "Security Groups: $securityGroups" -ForegroundColor Gray
            
            foreach ($sg in $securityGroups.Split(" ")) {
                if ($sg.Trim()) {
                    Write-Host ""
                    Write-Host "Security Group: $sg" -ForegroundColor Cyan
                    aws ec2 describe-security-groups --group-ids $sg --query 'SecurityGroups[0].{GroupId:GroupId,GroupName:GroupName,InboundRules:IpPermissions[].{FromPort:FromPort,ToPort:ToPort,Protocol:IpProtocol,Sources:IpRanges[].CidrIp}}' --output table --region $Region
                }
            }
        }
    }
} catch {
    Write-Host "❌ Failed to get security group details" -ForegroundColor Red
}

Write-Host ""
Write-Host "✅ Diagnosis Complete!" -ForegroundColor Green
Write-Host ""
Write-Host "💡 Common Issues to Check:" -ForegroundColor Yellow
Write-Host "1. Target Group health check path should be '/api/health'" -ForegroundColor White
Write-Host "2. Target Group port should be 3000" -ForegroundColor White
Write-Host "3. Security groups should allow inbound traffic on port 3000" -ForegroundColor White
Write-Host "4. Container should be binding to 0.0.0.0:3000 (check logs)" -ForegroundColor White
Write-Host "5. Health check timeout should be >= 15 seconds" -ForegroundColor White
