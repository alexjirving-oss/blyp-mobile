<#
  device_test_notifglance.ps1

  Convenience helper for on-device verification of the Android
  notification-glance ("Needs you") feature.

  Run this once an Android phone is connected via USB with USB debugging
  enabled. It installs the test APK, prints manual verification steps, and
  can post a few fake notifications so you can watch the glance populate.

  Usage:
    powershell -ExecutionPolicy Bypass -File tools\release\device_test_notifglance.ps1
    powershell -ExecutionPolicy Bypass -File tools\release\device_test_notifglance.ps1 -ApkPath "C:\path\to\blyp.apk"
#>

param(
  [string]$ApkPath
)

# Keep going on non-terminating errors so adb hiccups don't hard-crash the script.
$ErrorActionPreference = 'Continue'

function Write-Section($text) {
  Write-Host ''
  Write-Host ('=' * 64) -ForegroundColor DarkCyan
  Write-Host "  $text" -ForegroundColor Cyan
  Write-Host ('=' * 64) -ForegroundColor DarkCyan
}

# ---------------------------------------------------------------------------
Write-Section 'STEP 1 - Check for a connected device (adb devices)'
# ---------------------------------------------------------------------------

$adbDevicesRaw = $null
try {
  $adbDevicesRaw = & adb devices 2>&1
} catch {
  Write-Host "Could not run 'adb'. Is the Android platform-tools folder on your PATH?" -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red
  exit 0
}

Write-Host $adbDevicesRaw

# Parse serials: lines like "<serial>\tdevice" (ignore the header and 'offline'/'unauthorized').
$serials = @()
foreach ($line in ($adbDevicesRaw -split "`r?`n")) {
  if ($line -match '^\s*([A-Za-z0-9.:_-]+)\s+device\s*$') {
    $serials += $Matches[1]
  }
}

if ($serials.Count -eq 0) {
  Write-Host 'No device connected. Plug in your Android phone with USB debugging enabled, then re-run.' -ForegroundColor Yellow
  exit 0
}

Write-Host ("Connected device(s): " + ($serials -join ', ')) -ForegroundColor Green

# ---------------------------------------------------------------------------
Write-Section 'STEP 2 - Locate the test APK'
# ---------------------------------------------------------------------------

if (-not $ApkPath) {
  $downloads = Join-Path $env:USERPROFILE 'Downloads'
  Write-Host "No -ApkPath provided. Searching '$downloads' for newest 'blyp-*NOTIFGLANCE-TEST*.apk' ..."
  $candidate = Get-ChildItem -Path $downloads -Filter 'blyp-*NOTIFGLANCE-TEST*.apk' -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if ($candidate) {
    $ApkPath = $candidate.FullName
    Write-Host "Found: $ApkPath" -ForegroundColor Green
  } else {
    Write-Host "No matching APK found in '$downloads'." -ForegroundColor Yellow
    Write-Host "Build one (BUILD_RELEASE_CANDIDATE.ps1 produces blyp-vc<vc>-NOTIFGLANCE-TEST.apk) or pass -ApkPath." -ForegroundColor Yellow
    exit 0
  }
}

if (-not (Test-Path $ApkPath)) {
  Write-Host "APK not found at: $ApkPath" -ForegroundColor Red
  exit 0
}

# ---------------------------------------------------------------------------
Write-Section 'STEP 3 - Install the APK (adb install -r)'
# ---------------------------------------------------------------------------

Write-Host "Installing $ApkPath ..."
$installOut = & adb install -r "$ApkPath" 2>&1
Write-Host $installOut
if ($LASTEXITCODE -eq 0 -and ($installOut -match 'Success')) {
  Write-Host 'APK installed successfully.' -ForegroundColor Green
} else {
  Write-Host 'APK install reported a problem. Review the adb output above.' -ForegroundColor Red
}

# ---------------------------------------------------------------------------
Write-Section 'STEP 4 - Manual verification steps'
# ---------------------------------------------------------------------------

Write-Host @'
On the phone:
  1. Open Blyp.
  2. Go to Profile -> Your social hub.
  3. Find the "Needs you" card.
  4. Tap "Turn on notification access" -> read the disclosure -> tap "Continue".
  5. In the system "Notification access" list, enable Blyp.
  6. Return to Blyp; the "Needs you" glance should start populating.

Android 13+ note:
  If the Blyp toggle is greyed out and shows "Restricted setting", do:
    Settings > Apps > Blyp > (three-dot menu, top right) > "Allow restricted settings"
  then return to Notification access and enable Blyp again.
'@

# ---------------------------------------------------------------------------
Write-Section 'STEP 5 - Post 3 sample notifications (so the glance has data)'
# ---------------------------------------------------------------------------

$samples = @(
  @{ Tag = 'blyp_test_tiktok';    Title = 'TikTok';   Body = 'liked your video and started following you' },
  @{ Tag = 'blyp_test_instagram'; Title = 'Instagram'; Body = 'mentioned you in a comment' },
  @{ Tag = 'blyp_test_whatsapp';  Title = 'WhatsApp'; Body = 'Hey! Are we still on for tonight?' }
)

foreach ($s in $samples) {
  try {
    Write-Host ("Posting test notification: [{0}] {1}" -f $s.Title, $s.Body)
    $out = & adb shell cmd notification post -S bigtext -t "$($s.Title)" "$($s.Tag)" "$($s.Body)" 2>&1
    if ($out) { Write-Host $out }
    if ($LASTEXITCODE -eq 0) {
      Write-Host ("  -> posted '{0}'" -f $s.Title) -ForegroundColor Green
    } else {
      Write-Host ("  -> adb returned a non-zero exit code for '{0}'" -f $s.Title) -ForegroundColor Yellow
    }
  } catch {
    Write-Host ("  -> failed to post '{0}': {1}" -f $s.Title, $_.Exception.Message) -ForegroundColor Red
  }
}

Write-Host ''
Write-Host 'Done. Open Blyp and confirm the "Needs you" glance shows the test notifications.' -ForegroundColor Green
