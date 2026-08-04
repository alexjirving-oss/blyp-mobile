# Blyp Mobile - Asset Download Script
# This script downloads placeholder assets for development and testing

Write-Host "🎨 Downloading Blyp Mobile App Assets..." -ForegroundColor Magenta

try {
    # Download app icon (1024x1024)
    Write-Host "📱 Downloading app icon..." -ForegroundColor Cyan
    Invoke-WebRequest -Uri "https://via.placeholder.com/1024x1024/a855f7/ffffff.png?text=B" -OutFile "assets\icon.png" -ErrorAction Stop
    Write-Host "✅ App icon downloaded" -ForegroundColor Green

    # Download adaptive icon (1024x1024) 
    Write-Host "📱 Downloading adaptive icon..." -ForegroundColor Cyan
    Invoke-WebRequest -Uri "https://via.placeholder.com/1024x1024/a855f7/ffffff.png?text=B" -OutFile "assets\adaptive-icon.png" -ErrorAction Stop
    Write-Host "✅ Adaptive icon downloaded" -ForegroundColor Green

    # Download splash screen (1284x2778)
    Write-Host "🌟 Downloading splash screen..." -ForegroundColor Cyan
    Invoke-WebRequest -Uri "https://via.placeholder.com/1284x2778/0f172a/a855f7.png?text=Blyp" -OutFile "assets\splash.png" -ErrorAction Stop
    Write-Host "✅ Splash screen downloaded" -ForegroundColor Green

    # Download favicon (32x32)
    Write-Host "🌐 Downloading favicon..." -ForegroundColor Cyan
    Invoke-WebRequest -Uri "https://via.placeholder.com/32x32/a855f7/ffffff.png?text=B" -OutFile "assets\favicon.png" -ErrorAction Stop
    Write-Host "✅ Favicon downloaded" -ForegroundColor Green

    Write-Host ""
    Write-Host "🎉 All assets downloaded successfully!" -ForegroundColor Green
    Write-Host "📝 Note: These are placeholder assets. Replace with your custom designs before production build." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor White
    Write-Host "1. Run 'npm start' to test the app with new assets" -ForegroundColor White
    Write-Host "2. Scan QR code with Expo Go to test on device" -ForegroundColor White
    Write-Host "3. For Android Play release creation, use 'powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\release\BUILD_RELEASE_CANDIDATE.ps1 -ExpectedVersionCode <versionCode>'" -ForegroundColor White
}
catch {
    Write-Host "❌ Error downloading assets: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "💡 You may need to create assets manually or check your internet connection." -ForegroundColor Yellow
}