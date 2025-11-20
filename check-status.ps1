# Quick Status Check for Blyp Mobile App
Write-Host "Blyp Mobile - System Status Check" -ForegroundColor Cyan
Write-Host "==================================" -ForegroundColor Cyan
Write-Host ""

$allGood = $true

# Check Node.js
Write-Host "1. Checking Node.js..." -NoNewline
$nodeCheck = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCheck) {
    $nodeVer = node --version
    Write-Host " OK $nodeVer" -ForegroundColor Green
} else {
    Write-Host " MISSING" -ForegroundColor Red
    $allGood = $false
}

# Check NPM packages
Write-Host "2. Checking NPM packages..." -NoNewline
if (Test-Path "node_modules") {
    Write-Host " OK" -ForegroundColor Green
} else {
    Write-Host " MISSING - Run npm install" -ForegroundColor Red
    $allGood = $false
}

# Check Firebase config
Write-Host "3. Checking Firebase config..." -NoNewline
if (Test-Path "src\config\firebase.js") {
    $fbConfig = Get-Content "src\config\firebase.js" -Raw
    if ($fbConfig -like "*AIzaSy*") {
        Write-Host " OK" -ForegroundColor Green
    } else {
        Write-Host " MISSING CREDENTIALS" -ForegroundColor Red
        $allGood = $false
    }
} else {
    Write-Host " FILE NOT FOUND" -ForegroundColor Red
    $allGood = $false
}

# Check Expo
Write-Host "4. Checking Expo CLI..." -NoNewline
$expoCheck = Get-Command npx -ErrorAction SilentlyContinue
if ($expoCheck) {
    Write-Host " OK" -ForegroundColor Green
} else {
    Write-Host " MISSING" -ForegroundColor Red
    $allGood = $false
}

# Check ADB (optional)
Write-Host "5. Checking ADB..." -NoNewline
$adbPath = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
if (Test-Path $adbPath) {
    Write-Host " AVAILABLE" -ForegroundColor Green
} else {
    Write-Host " NOT INSTALLED (optional)" -ForegroundColor Yellow
}

# Check port 8081
Write-Host "6. Checking port 8081..." -NoNewline
$portCheck = netstat -ano | Select-String ":8081"
if ($portCheck) {
    Write-Host " IN USE (will clear)" -ForegroundColor Yellow
} else {
    Write-Host " FREE" -ForegroundColor Green
}

# Check LiveStream feature
Write-Host "7. Checking LiveStream..." -NoNewline
if (Test-Path "src\config\StreamingFeatureFlag.js") {
    $flagContent = Get-Content "src\config\StreamingFeatureFlag.js" -Raw
    if ($flagContent -like "*BUILD_ENABLE_LIVE_STREAMING = true*") {
        Write-Host " ENABLED" -ForegroundColor Green
    } else {
        Write-Host " DISABLED" -ForegroundColor Yellow
    }
} else {
    Write-Host " FILE NOT FOUND" -ForegroundColor Red
}

# Summary
Write-Host ""
Write-Host "==================================" -ForegroundColor Cyan
if ($allGood) {
    Write-Host "READY TO START" -ForegroundColor Green
    Write-Host ""
    Write-Host "Run: .\start-app.ps1" -ForegroundColor White
    Write-Host "Or:  npx expo start --clear" -ForegroundColor White
} else {
    Write-Host "ISSUES FOUND - Fix above errors first" -ForegroundColor Red
}
Write-Host ""