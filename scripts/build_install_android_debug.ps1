param(
  [Parameter(Mandatory=$true)][string]$Serial
)

$ErrorActionPreference="Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $RepoRoot

Write-Host "== adb visible? =="
adb devices -l | Out-Host

Write-Host "== Clean + Assemble debug APK =="
Set-Location (Join-Path $RepoRoot "android")
if (Test-Path "./gradlew") { ./gradlew clean assembleDebug } else { gradlew clean assembleDebug }

$apk = Join-Path $RepoRoot "android\app\build\outputs\apk\debug\app-debug.apk"
if (-not (Test-Path $apk)) { throw "APK not found at $apk" }

Write-Host "== Install to $Serial =="
adb -s $Serial install -r -d $apk | Out-Host

Write-Host "== Launch app =="
adb -s $Serial shell monkey -p com.blyp.mobile -c android.intent.category.LAUNCHER 1 | Out-Host
