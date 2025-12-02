# One-Time Firestore Reset - Deployment Script
# Run this from the functions/ directory

Write-Host "🔥 BLYP Dev Firestore Reset - Deployment" -ForegroundColor Yellow
Write-Host ""

# Step 1: Generate secret key
Write-Host "Step 1: Generating secret key..." -ForegroundColor Cyan
$secret = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 32 | ForEach-Object {[char]$_})
Write-Host "✅ Secret key generated: $secret" -ForegroundColor Green
Write-Host ""
Write-Host "⚠️  SAVE THIS KEY - You'll need it to call the function!" -ForegroundColor Red
Write-Host ""

# Step 2: Set Firebase config
Write-Host "Step 2: Setting Firebase Functions config..." -ForegroundColor Cyan
firebase functions:config:set admin.dev_reset_key="$secret" blyp.env="dev"
Write-Host ""

# Step 3: Deploy function
Write-Host "Step 3: Deploying devResetFirestore function..." -ForegroundColor Cyan
firebase deploy --only functions:devResetFirestore
Write-Host ""

# Step 4: Get function URL
Write-Host "✅ Deployment complete!" -ForegroundColor Green
Write-Host ""
Write-Host "📋 To call the function:" -ForegroundColor Yellow
Write-Host ""
Write-Host "curl -X POST ``" -ForegroundColor White
Write-Host "  -H `"x-admin-reset-key: $secret`" ``" -ForegroundColor White
Write-Host "  `"https://us-central1-blyp-610ee.cloudfunctions.net/devResetFirestore`"" -ForegroundColor White
Write-Host ""
Write-Host "Or use Invoke-WebRequest:" -ForegroundColor Yellow
Write-Host ""
Write-Host "`$headers = @{ 'x-admin-reset-key' = '$secret' }" -ForegroundColor White
Write-Host "Invoke-WebRequest -Method POST ``" -ForegroundColor White
Write-Host "  -Uri 'https://us-central1-blyp-610ee.cloudfunctions.net/devResetFirestore' ``" -ForegroundColor White
Write-Host "  -Headers `$headers" -ForegroundColor White
Write-Host ""
Write-Host "⚠️  After running reset, delete this function:" -ForegroundColor Red
Write-Host "   - Comment out export in src/index.ts" -ForegroundColor White
Write-Host "   - Run: firebase deploy --only functions" -ForegroundColor White
