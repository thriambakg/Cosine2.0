# Test Portfolio Analysis API
# Replace YOUR_API_GATEWAY_URL with your actual API Gateway URL

$API_URL = "https://your-api-gateway-url.amazonaws.com/production/portfolio"
$payload = Get-Content "test-payload.json" -Raw

Write-Host "🧪 Testing Portfolio Analysis API..." -ForegroundColor Cyan
Write-Host "📍 URL: $API_URL" -ForegroundColor Yellow
Write-Host "📦 Payload:" -ForegroundColor Green
Write-Host $payload -ForegroundColor Gray
Write-Host ""

try {
    Write-Host "🚀 Making request..." -ForegroundColor Magenta
    
    $response = Invoke-RestMethod -Uri $API_URL -Method POST -Body $payload -ContentType "application/json" -ErrorAction Stop
    
    Write-Host "✅ Success!" -ForegroundColor Green
    Write-Host "📊 Response:" -ForegroundColor Cyan
    $response | ConvertTo-Json -Depth 10
} catch {
    Write-Host "❌ Error occurred:" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    
    if ($_.Exception.Response) {
        $statusCode = $_.Exception.Response.StatusCode.value__
        Write-Host "📈 Status Code: $statusCode" -ForegroundColor Yellow
        
        $responseBody = $_.Exception.Response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($responseBody)
        $responseText = $reader.ReadToEnd()
        Write-Host "📄 Response Body:" -ForegroundColor Yellow
        Write-Host $responseText -ForegroundColor Gray
    }
}
