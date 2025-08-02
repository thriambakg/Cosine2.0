# Cognito Callback URL Update Script
# Updates Base Infrastructure Cognito callback URLs to match frontend ALB DNS

param(
    [string]$Environment = "staging"
)

# Colors for output  
$Red = [System.ConsoleColor]::Red
$Green = [System.ConsoleColor]::Green
$Yellow = [System.ConsoleColor]::Yellow
$Blue = [System.ConsoleColor]::Blue

function Write-ColorOutput {
    param([string]$Message, [System.ConsoleColor]$Color = [System.ConsoleColor]::White)
    Write-Host $Message -ForegroundColor $Color
}

Write-ColorOutput "🔗 Cognito Callback URL Update Script" $Blue
Write-ColorOutput "====================================" $Blue

# Step 1: Get ALB DNS from Cosine2.0 infrastructure
Write-ColorOutput "📋 Environment: $Environment" $Blue
Write-ColorOutput "🔍 Getting ALB DNS from Cosine2.0 infrastructure..." $Blue

if (-not (Test-Path "terraform/main.tf")) {
    Write-ColorOutput "❌ Error: Run this script from the Cosine2.0 project root directory" $Red
    exit 1
}

# Get to Cosine2.0 terraform directory
Set-Location terraform

# Check if terraform output is available
try {
    $ALB_DNS_URL = terraform output -raw alb_dns_url
    if ([string]::IsNullOrEmpty($ALB_DNS_URL)) {
        throw "Empty output"
    }
} catch {
    Write-ColorOutput "❌ Error: Could not get ALB DNS URL from Cosine2.0 terraform output" $Red
    Write-ColorOutput "💡 Make sure you've deployed Cosine2.0 infrastructure first:" $Yellow
    Write-Host "   cd terraform"
    Write-Host "   terraform apply"
    exit 1
}

Write-ColorOutput "✅ ALB DNS URL: $ALB_DNS_URL" $Green

# Extract base URL (remove protocol for building callback URLs)
$BASE_URL = $ALB_DNS_URL -replace "^https?://", ""
$HTTPS_BASE = "https://$BASE_URL"
$HTTP_BASE = "http://$BASE_URL"

Write-ColorOutput "🔧 Updating Base Infrastructure Cognito configuration..." $Blue

# Step 2: Update Base Infrastructure tfvars file
$BASE_INFRA_TFVARS = "../Cosine-Base-Infra/terraform/environments/$Environment.auto.tfvars"

if (-not (Test-Path $BASE_INFRA_TFVARS)) {
    Write-ColorOutput "❌ Error: Base infrastructure tfvars file not found: $BASE_INFRA_TFVARS" $Red
    Write-ColorOutput "💡 Expected path: $BASE_INFRA_TFVARS" $Yellow
    exit 1
}

Write-ColorOutput "📝 Updating $BASE_INFRA_TFVARS..." $Blue

# Read the current tfvars file
$content = Get-Content $BASE_INFRA_TFVARS -Raw

# Create new callback URLs configuration
$newCallbackUrls = @"
cognito_callback_urls = [
  "$HTTPS_BASE",
  "$HTTPS_BASE/auth/callback",
  "$HTTPS_BASE/auth/signin",
  "$HTTP_BASE",
  "$HTTP_BASE/auth/callback",
  "$HTTP_BASE/auth/signin"
]
cognito_logout_urls = [
  "$HTTPS_BASE",
  "$HTTPS_BASE/auth/logout",
  "$HTTP_BASE",
  "$HTTP_BASE/auth/logout"
]
"@

# Replace existing callback URLs configuration
if ($content -match "cognito_callback_urls\s*=\s*\[[^\]]*\]") {
    $content = $content -replace "cognito_callback_urls\s*=\s*\[[^\]]*\]", "cognito_callback_urls = [`r`n  `"$HTTPS_BASE`",`r`n  `"$HTTPS_BASE/auth/callback`",`r`n  `"$HTTPS_BASE/auth/signin`",`r`n  `"$HTTP_BASE`",`r`n  `"$HTTP_BASE/auth/callback`",`r`n  `"$HTTP_BASE/auth/signin`"`r`n]"
} else {
    # Add callback URLs if not present
    $content += "`r`n`r`n# Updated Cognito callback URLs to match ALB DNS`r`n$newCallbackUrls"
}

if ($content -match "cognito_logout_urls\s*=\s*\[[^\]]*\]") {
    $content = $content -replace "cognito_logout_urls\s*=\s*\[[^\]]*\]", "cognito_logout_urls = [`r`n  `"$HTTPS_BASE`",`r`n  `"$HTTPS_BASE/auth/logout`",`r`n  `"$HTTP_BASE`",`r`n  `"$HTTP_BASE/auth/logout`"`r`n]"
} else {
    # Add logout URLs if not present  
    $content += "`r`ncognito_logout_urls = [`r`n  `"$HTTPS_BASE`",`r`n  `"$HTTPS_BASE/auth/logout`",`r`n  `"$HTTP_BASE`",`r`n  `"$HTTP_BASE/auth/logout`"`r`n]"
}

# Write updated content
Set-Content -Path $BASE_INFRA_TFVARS -Value $content

Write-ColorOutput "✅ Updated Base Infrastructure tfvars file" $Green

# Step 3: Apply Base Infrastructure changes
Write-ColorOutput "🚀 Applying Base Infrastructure changes..." $Blue

Set-Location "../Cosine-Base-Infra/terraform"

if (-not (Test-Path ".terraform")) {
    Write-ColorOutput "⚠️  Base Infrastructure terraform not initialized. Running terraform init..." $Yellow
    terraform init
}

Write-ColorOutput "📋 Planned changes for Base Infrastructure:" $Blue
terraform plan

Write-Host ""
$confirmation = Read-Host "🤔 Apply these changes to Base Infrastructure? (y/N)"

if ($confirmation -eq "y" -or $confirmation -eq "Y") {
    Write-ColorOutput "⚡ Applying changes..." $Blue
    terraform apply -auto-approve
    
    if ($LASTEXITCODE -eq 0) {
        Write-ColorOutput "✅ Base Infrastructure updated successfully!" $Green
    } else {
        Write-ColorOutput "❌ Error: Base Infrastructure update failed" $Red
        exit 1
    }
} else {
    Write-ColorOutput "⏸️  Skipped applying changes. Manual apply required:" $Yellow
    Write-Host "   cd ../Cosine-Base-Infra/terraform"
    Write-Host "   terraform apply"
}

Write-Host ""
Write-ColorOutput "==================================================" $Green
Write-ColorOutput "🎉 COGNITO CALLBACK UPDATE COMPLETE!" $Green  
Write-ColorOutput "==================================================" $Green
Write-ColorOutput "🔗 Callback URLs updated to:" $Blue
Write-Host "   • $HTTPS_BASE"
Write-Host "   • $HTTPS_BASE/auth/callback"
Write-Host "   • $HTTPS_BASE/auth/signin"
Write-Host "   • $HTTP_BASE (fallback)"
Write-Host "   • $HTTP_BASE/auth/callback (fallback)"
Write-Host "   • $HTTP_BASE/auth/signin (fallback)"
Write-Host ""
Write-ColorOutput "🌐 Your website should now support authentication at:" $Green
Write-ColorOutput "   $ALB_DNS_URL" $Green
Write-Host ""
Write-ColorOutput "🔧 Next Steps:" $Blue
Write-Host "1. Test website login functionality"
Write-Host "2. Verify OAuth providers work correctly"
Write-Host "3. Check CloudWatch logs for any auth errors"
Write-Host ""
