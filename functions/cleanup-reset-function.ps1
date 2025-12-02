# Cleanup Script - Remove devResetFirestore after use
# Run this from project root after you've successfully reset Firestore

Write-Host "🧹 Cleaning up devResetFirestore function..." -ForegroundColor Yellow
Write-Host ""

# Step 1: Comment out export
Write-Host "Step 1: Removing export from index.ts..." -ForegroundColor Cyan
$indexPath = "functions\src\index.ts"
$content = Get-Content $indexPath
$newContent = $content -replace "export \{ devResetFirestore \} from './devReset';", "// export { devResetFirestore } from './devReset'; // REMOVED - one-time use only"
$newContent | Set-Content $indexPath
Write-Host "✅ Export commented out" -ForegroundColor Green
Write-Host ""

# Step 2: Redeploy
Write-Host "Step 2: Redeploying functions..." -ForegroundColor Cyan
firebase deploy --only functions
Write-Host ""

Write-Host "✅ Cleanup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "The devResetFirestore function is now removed from your Firebase project." -ForegroundColor White
Write-Host "You can optionally delete functions/src/devReset.ts if you want." -ForegroundColor Gray
