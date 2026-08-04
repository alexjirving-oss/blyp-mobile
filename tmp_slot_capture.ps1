$ErrorActionPreference="Stop"
$ViewerSerial="RFCY71ZFS6F"
$Root=(Resolve-Path ".").Path
$Logs=Join-Path $Root "logs"
New-Item -ItemType Directory -Force $Logs | Out-Null
$ts=Get-Date -Format "yyyyMMdd_HHmmss"
$viewerLog=Join-Path $Logs ("viewer_slot_proof_" + $ts + ".log")

adb -s $ViewerSerial logcat -c

Write-Host ""
Write-Host "HOST PHONE: press Go Live NOW. Then press Enter here."
Read-Host | Out-Null

Write-Host ""
Write-Host "VIEWER PHONE: tap the stream to join NOW. Then press Enter here."
Read-Host | Out-Null

Start-Sleep -Seconds 15

adb -s $ViewerSerial logcat -v time -d 2>&1 | Out-File -FilePath $viewerLog -Encoding utf8

Write-Host ""
Write-Host ("Saved: " + $viewerLog)
Write-Host ""

$pattern="IVS_SLOT|tryAttach|ATTACHED|IVS_SURFACE_READY|IVSRealTimeView|IVS_NATIVE|surfaceCreated|surfaceDestroyed|SurfaceView|firstFrame|Exception|IllegalState|Surface is null|SURFACE_STATE|RENDER_SLOT"
$hits = Select-String -Path $viewerLog -Pattern $pattern

Write-Host "---- COUNTS ----"
Write-Host ("IVS_SLOT: " + ((Select-String -Path $viewerLog -Pattern "IVS_SLOT" | Measure-Object).Count))
Write-Host ("tryAttach: " + ((Select-String -Path $viewerLog -Pattern "tryAttach" | Measure-Object).Count))
Write-Host ("ATTACHED: " + ((Select-String -Path $viewerLog -Pattern "ATTACHED" | Measure-Object).Count))
Write-Host ("firstFrame: " + ((Select-String -Path $viewerLog -Pattern "firstFrame" | Measure-Object).Count))
Write-Host ""
Write-Host "---- LAST 200 RELEVANT LINES ----"
$hits | Select-Object -Last 200
