$ErrorActionPreference="Stop"

$HostSerial  = "R5CX71NM1RK"
$ViewerSerial= "RFCY71ZFS6F"

$Root = (Resolve-Path ".").Path
$Logs = Join-Path $Root "logs"
New-Item -ItemType Directory -Force $Logs | Out-Null
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$buildLog = Join-Path $Logs ("devclient_rebuild_install_" + $ts + ".log")

Write-Host "== ADB sanity =="
adb kill-server | Out-Null
adb start-server | Out-Null
$devices = (adb devices) -join "`n"
if ($devices -notmatch $HostSerial)  { throw "Host device not detected: $HostSerial. Run: adb devices -l" }
if ($devices -notmatch $ViewerSerial){ throw "Viewer device not detected: $ViewerSerial. Run: adb devices -l" }

Write-Host "== JS typecheck =="
npm run -s typecheck 2>&1 | Tee-Object -FilePath $buildLog -Append

Write-Host "== Android build (clean + assembleDebug) =="
Push-Location (Join-Path $Root "android")
./gradlew.bat clean 2>&1 | Tee-Object -FilePath $buildLog -Append
./gradlew.bat :app:assembleDebug 2>&1 | Tee-Object -FilePath $buildLog -Append
Pop-Location

$apk = Join-Path $Root "android\app\build\outputs\apk\debug\app-debug.apk"
if (!(Test-Path $apk)) { throw "APK not found at: $apk" }

Write-Host "== Install APK to BOTH devices =="
adb -s $HostSerial   install -r -d -g "$apk" 2>&1 | Tee-Object -FilePath $buildLog -Append
adb -s $ViewerSerial install -r -d -g "$apk" 2>&1 | Tee-Object -FilePath $buildLog -Append

Write-Host ""
Write-Host "OK ✅ Installed to both devices"
Write-Host ("APK:      " + $apk)
Write-Host ("BuildLog: " + $buildLog)
