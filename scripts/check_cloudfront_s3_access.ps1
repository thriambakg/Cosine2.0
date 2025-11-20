# PowerShell script to diagnose CloudFront + S3 403 errors
# Usage: .\check_cloudfront_s3_access.ps1 [environment] [project_name]

param(
    [string]$Environment = "production",
    [string]$ProjectName = "cosine"
)

$ErrorActionPreference = "Continue"

$BucketName = "${ProjectName}-static-hosting-${Environment}"

Write-Host "=== CloudFront + S3 Access Diagnostic ===" -ForegroundColor Cyan
Write-Host ""

# Check if AWS CLI is available
try {
    $awsVersion = aws --version 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "AWS CLI not found"
    }
} catch {
    Write-Host "❌ AWS CLI is not installed or not in PATH" -ForegroundColor Red
    Write-Host "Please install AWS CLI: https://aws.amazon.com/cli/" -ForegroundColor Yellow
    exit 1
}

# Check if bucket exists
Write-Host "1. Checking if S3 bucket exists: ${BucketName}" -ForegroundColor Yellow
try {
    $bucketCheck = aws s3 ls "s3://${BucketName}" 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "   ✅ Bucket exists" -ForegroundColor Green
    } else {
        Write-Host "   ❌ Bucket does not exist or access denied!" -ForegroundColor Red
        Write-Host "   Error: $bucketCheck" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "   ❌ Error checking bucket: $_" -ForegroundColor Red
    exit 1
}

# Check bucket policy
Write-Host ""
Write-Host "2. Checking S3 bucket policy..." -ForegroundColor Yellow
try {
    $bucketPolicy = aws s3api get-bucket-policy --bucket "${BucketName}" 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "   ✅ Bucket policy exists" -ForegroundColor Green
        $policyJson = $bucketPolicy | ConvertFrom-Json
        Write-Host "   Policy:" -ForegroundColor Cyan
        $policyJson.Policy | ConvertFrom-Json | ConvertTo-Json -Depth 10 | Write-Host
        
        # Check if policy allows CloudFront
        $policyContent = $policyJson.Policy | ConvertFrom-Json
        $hasCloudFront = $policyContent.Statement | Where-Object { 
            $_.Principal.Service -eq "cloudfront.amazonaws.com" -or 
            $_.Principal.Service -like "*cloudfront*"
        }
        if ($hasCloudFront) {
            Write-Host "   ✅ Policy allows CloudFront access" -ForegroundColor Green
        } else {
            Write-Host "   ⚠️  Policy may not allow CloudFront access" -ForegroundColor Yellow
        }
    } else {
        if ($bucketPolicy -match "NoSuchBucketPolicy") {
            Write-Host "   ❌ No bucket policy found! This is likely the issue." -ForegroundColor Red
            Write-Host "   The bucket policy should allow CloudFront to access the bucket." -ForegroundColor Yellow
        } else {
            Write-Host "   ⚠️  Error retrieving bucket policy: $bucketPolicy" -ForegroundColor Yellow
        }
    }
} catch {
    Write-Host "   ⚠️  Error checking bucket policy: $_" -ForegroundColor Yellow
}

# Check public access block settings
Write-Host ""
Write-Host "3. Checking S3 bucket public access block settings..." -ForegroundColor Yellow
try {
    $publicAccess = aws s3api get-public-access-block --bucket "${BucketName}" 2>&1
    if ($LASTEXITCODE -eq 0) {
        $accessConfig = $publicAccess | ConvertFrom-Json
        Write-Host "   Public Access Block Configuration:" -ForegroundColor Cyan
        $accessConfig.PublicAccessBlockConfiguration | Format-List | Write-Host
        
        $blockPublicPolicy = $accessConfig.PublicAccessBlockConfiguration.BlockPublicPolicy
        $restrictPublicBuckets = $accessConfig.PublicAccessBlockConfiguration.RestrictPublicBuckets
        
        if ($blockPublicPolicy -eq $true -or $restrictPublicBuckets -eq $true) {
            Write-Host "   ⚠️  Public access block may be preventing CloudFront access" -ForegroundColor Yellow
            Write-Host "   For OAC, block_public_policy and restrict_public_buckets should be false" -ForegroundColor Yellow
        } else {
            Write-Host "   ✅ Public access block settings are correct for OAC" -ForegroundColor Green
        }
    } else {
        if ($publicAccess -match "NoSuchPublicAccessBlockConfiguration") {
            Write-Host "   ⚠️  No public access block configuration found" -ForegroundColor Yellow
        } else {
            Write-Host "   ⚠️  Error retrieving public access block: $publicAccess" -ForegroundColor Yellow
        }
    }
} catch {
    Write-Host "   ⚠️  Error checking public access block: $_" -ForegroundColor Yellow
}

# Check if files exist in bucket
Write-Host ""
Write-Host "4. Checking if files exist in S3 bucket..." -ForegroundColor Yellow
try {
    $files = aws s3 ls "s3://${BucketName}/" --recursive 2>&1
    if ($LASTEXITCODE -eq 0) {
        $fileCount = ($files | Measure-Object -Line).Lines
        if ($fileCount -eq 0) {
            Write-Host "   ❌ No files found in bucket! Files need to be uploaded." -ForegroundColor Red
        } else {
            Write-Host "   ✅ Found $fileCount files in bucket" -ForegroundColor Green
            Write-Host "   First few files:" -ForegroundColor Cyan
            $files | Select-Object -First 5 | ForEach-Object { Write-Host "     $_" }
            
            # Check for index.html
            $hasIndex = $files | Select-String -Pattern "index\.html"
            if ($hasIndex) {
                Write-Host "   ✅ index.html found" -ForegroundColor Green
            } else {
                Write-Host "   ⚠️  index.html not found (may cause 403 errors)" -ForegroundColor Yellow
            }
        }
    } else {
        Write-Host "   ⚠️  Error listing files: $files" -ForegroundColor Yellow
    }
} catch {
    Write-Host "   ⚠️  Error checking files: $_" -ForegroundColor Yellow
}

# Check CloudFront distributions
Write-Host ""
Write-Host "5. Checking CloudFront distributions..." -ForegroundColor Yellow
try {
    $distributions = aws cloudfront list-distributions --output json 2>&1
    if ($LASTEXITCODE -eq 0) {
        $distJson = $distributions | ConvertFrom-Json
        $matchingDists = $distJson.DistributionList.Items | Where-Object {
            $_.Origins.Items[0].DomainName -like "*${BucketName}*"
        }
        
        if ($matchingDists.Count -eq 0) {
            Write-Host "   ⚠️  No CloudFront distribution found for this bucket" -ForegroundColor Yellow
        } else {
            Write-Host "   ✅ Found $($matchingDists.Count) CloudFront distribution(s):" -ForegroundColor Green
            foreach ($dist in $matchingDists) {
                Write-Host "     Distribution ID: $($dist.Id)" -ForegroundColor Cyan
                Write-Host "     Status: $($dist.Status)" -ForegroundColor Cyan
                Write-Host "     Domain Name: $($dist.DomainName)" -ForegroundColor Cyan
                Write-Host "     ARN: $($dist.ARN)" -ForegroundColor Cyan
                
                if ($dist.Status -ne "Deployed") {
                    Write-Host "     ⚠️  Distribution is not fully deployed (Status: $($dist.Status))" -ForegroundColor Yellow
                    Write-Host "     CloudFront distributions can take 15-30 minutes to deploy" -ForegroundColor Yellow
                } else {
                    Write-Host "     ✅ Distribution is deployed" -ForegroundColor Green
                }
                
                # Check aliases
                if ($dist.Aliases.Items.Count -gt 0) {
                    Write-Host "     Aliases: $($dist.Aliases.Items -join ', ')" -ForegroundColor Cyan
                    if ($dist.Aliases.Items -contains "investcosine.com" -or $dist.Aliases.Items -contains "www.investcosine.com") {
                        Write-Host "     ✅ This appears to be the production distribution" -ForegroundColor Green
                    }
                } else {
                    Write-Host "     No aliases configured" -ForegroundColor Yellow
                }
                
                # Check OAC configuration
                Write-Host ""
                Write-Host "     Checking Origin Access Control (OAC)..." -ForegroundColor Yellow
                try {
                    $distConfig = aws cloudfront get-distribution --id $dist.Id --output json 2>&1
                    if ($LASTEXITCODE -eq 0) {
                        $configJson = $distConfig | ConvertFrom-Json
                        $oacId = $configJson.Distribution.DistributionConfig.Origins.Items[0].OriginAccessControlId
                        if ([string]::IsNullOrEmpty($oacId)) {
                            Write-Host "     ❌ No Origin Access Control (OAC) configured!" -ForegroundColor Red
                            Write-Host "     This is likely causing the 403 error!" -ForegroundColor Red
                            Write-Host ""
                            Write-Host "     🔧 FIX: Run 'terraform apply' in Cosine2.0/terraform to update this distribution" -ForegroundColor Yellow
                            Write-Host "     Note: CloudFront updates can take 15-30 minutes to deploy" -ForegroundColor Yellow
                        } else {
                            Write-Host "     ✅ Origin Access Control configured: $oacId" -ForegroundColor Green
                        }
                    }
                } catch {
                    Write-Host "     ⚠️  Error checking OAC: $_" -ForegroundColor Yellow
                }
                Write-Host ""
            }
        }
    } else {
        Write-Host "   ⚠️  Error listing distributions: $distributions" -ForegroundColor Yellow
    }
} catch {
    Write-Host "   ⚠️  Error checking CloudFront: $_" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== Diagnostic Complete ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "=== FIX INSTRUCTIONS ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "If OAC is missing, run the following to fix:" -ForegroundColor Yellow
Write-Host ""
Write-Host "1. Navigate to terraform directory:" -ForegroundColor White
Write-Host "   cd Cosine2.0\terraform" -ForegroundColor Cyan
Write-Host ""
Write-Host "2. Initialize Terraform (if needed):" -ForegroundColor White
Write-Host "   terraform init" -ForegroundColor Cyan
Write-Host ""
Write-Host "3. Plan the changes:" -ForegroundColor White
Write-Host "   terraform plan" -ForegroundColor Cyan
Write-Host ""
Write-Host "4. Apply the changes:" -ForegroundColor White
Write-Host "   terraform apply" -ForegroundColor Cyan
Write-Host ""
Write-Host "   This will:" -ForegroundColor White
Write-Host "   - Create/update the Origin Access Control (OAC)" -ForegroundColor Gray
Write-Host "   - Update the CloudFront distribution to use OAC" -ForegroundColor Gray
Write-Host "   - Apply the S3 bucket policy allowing CloudFront access" -ForegroundColor Gray
Write-Host ""
Write-Host "5. Wait for CloudFront to deploy (15-30 minutes)" -ForegroundColor White
Write-Host "   You can check status with:" -ForegroundColor Gray
Write-Host "   aws cloudfront get-distribution --id <DISTRIBUTION_ID>" -ForegroundColor Cyan
Write-Host ""
Write-Host "Common fixes for 403 errors:" -ForegroundColor Yellow
Write-Host "1. ✅ Ensure bucket policy allows CloudFront service principal" -ForegroundColor White
Write-Host "2. ✅ Ensure public access block allows bucket policy (block_public_policy = false)" -ForegroundColor White
Write-Host "3. ❌ Ensure CloudFront distribution has OAC configured (REQUIRES TERRAFORM APPLY)" -ForegroundColor Red
Write-Host "4. ✅ Ensure files are uploaded to S3 bucket (especially index.html)" -ForegroundColor White
Write-Host "5. ⏳ Wait for CloudFront distribution to deploy (can take 15-30 minutes)" -ForegroundColor White

