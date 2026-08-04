[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$Serial,
  [Parameter(Mandatory=$true)][string]$ApkPath,
  [string]$Package = "com.blyp.mobile",
  [string]$Activity = ".MainActivity",
  [int]$DurationSec = 25,
  [switch]$KeepData
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $ApkPath)) { throw "APK not found: $ApkPath" }

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$root = Join-Path (Resolve-Path ".") ("artifacts\\smoke\\" + $ts + "\\" + $Serial)
New-Item -ItemType Directory -Force -Path $root | Out-Null

(& adb -s $Serial get-state 2>&1) | Out-File -Encoding utf8 (Join-Path $root "00_state.txt")
(& adb -s $Serial shell getprop ro.product.model 2>&1) | Out-File -Encoding utf8 (Join-Path $root "00_model.txt")

# Clear buffer for tight window
adb -s $Serial logcat -c | Out-Null

# Uninstall (ignore errors) — skipped when upgrading in place to preserve login state.
if (-not $KeepData) {
  adb -s $Serial uninstall $Package 2>&1 | Out-File -Encoding utf8 (Join-Path $root "01_uninstall.txt")
} else {
  "SKIPPED_KEEP_DATA=1" | Out-File -Encoding utf8 (Join-Path $root "01_uninstall.txt")
}

# Install
$installLog = Join-Path $root "02_install.txt"
$installOut = adb -s $Serial install -r "$ApkPath" 2>&1
$installOut | Out-File -Encoding utf8 $installLog
if ($LASTEXITCODE -ne 0 -or -not ($installOut -match "Success")) {
  throw "INSTALL FAIL on $Serial. See $installLog"
}

# Version info
adb -s $Serial shell dumpsys package $Package 2>&1 | Select-String "versionName|versionCode|lastUpdateTime" | Out-File -Encoding utf8 (Join-Path $root "03_version.txt")

# Launch
$launchLog = Join-Path $root "04_launch.txt"
$launchOut = adb -s $Serial shell am start -n "$Package/$Activity" 2>&1
$launchOut | Out-File -Encoding utf8 $launchLog
if ($LASTEXITCODE -ne 0 -or ($launchOut -match "Error:|Exception")) {
  throw "LAUNCH FAIL on $Serial. See $launchLog"
}

# ---------------- BLYP_AUTO_OPEN_LIVE ----------------
# Objective: Attempt to drive execution into LiveStreamScreen during smoke
# without modifying app source. This relies on the app handling deep links.
#
# Notes:
# - AndroidManifest registers the custom scheme "blyp".
# - The app may ignore these links in release builds; we still capture results.
$autoOpenLog = Join-Path $root "04b_auto_open_live.txt"
"AUTO_OPEN_START=$(Get-Date -Format o)" | Out-File -Encoding utf8 $autoOpenLog

function Get-BlypUiDump {
  param(
    [Parameter(Mandatory=$true)][string]$Serial,
    [Parameter(Mandatory=$true)][string]$OutFile
  )

  $remote = "/sdcard/blyp_window_dump.xml"
  adb -s $Serial shell uiautomator dump $remote 2>&1 | Out-Null
  adb -s $Serial pull $remote $OutFile 2>&1 | Out-Null
  if (-not (Test-Path -LiteralPath $OutFile)) { return $null }
  try {
    [xml](Get-Content -LiteralPath $OutFile -Raw)
  } catch {
    return $null
  }
}

function Parse-AndroidBounds {
  param([Parameter(Mandatory=$true)][string]$Bounds)
  # Format: [l,t][r,b]
  $m = [regex]::Match($Bounds, "\[(\d+),(\d+)\]\[(\d+),(\d+)\]")
  if (-not $m.Success) { return $null }
  $l = [int]$m.Groups[1].Value
  $t = [int]$m.Groups[2].Value
  $r = [int]$m.Groups[3].Value
  $b = [int]$m.Groups[4].Value
  return [pscustomobject]@{ L=$l; T=$t; R=$r; B=$b; CX=[int](($l+$r)/2); CY=[int](($t+$b)/2); Area=($r-$l)*($b-$t) }
}

function Find-NodesByText {
  param(
    [Parameter(Mandatory=$true)]$Xml,
    [Parameter(Mandatory=$true)][string]$Text
  )
  if (-not $Xml) { return @() }
  $nodes = @()
  try {
    $nodes = $Xml.SelectNodes("//node[@text='$Text']")
  } catch {
    $nodes = @()
  }
  return @($nodes)
}

function Find-NodesByClass {
  param(
    [Parameter(Mandatory=$true)]$Xml,
    [Parameter(Mandatory=$true)][string]$Class
  )
  if (-not $Xml) { return @() }
  $nodes = @()
  try {
    $nodes = $Xml.SelectNodes("//node[@class='$Class']")
  } catch {
    $nodes = @()
  }
  return @($nodes)
}

function Tap-Bounds {
  param(
    [Parameter(Mandatory=$true)][string]$Serial,
    [Parameter(Mandatory=$true)][string]$Bounds
  )
  $b = Parse-AndroidBounds -Bounds $Bounds
  if (-not $b) { return $false }
  adb -s $Serial shell input tap $b.CX $b.CY 2>&1 | Out-Null
  return $true
}

function Sanitize-AdbInputText {
  param([Parameter(Mandatory=$true)][string]$Text)
  # adb input text treats spaces specially; keep this conservative.
  $t = [string]$Text
  $t = $t -replace " ", "%s"
  return $t
}

# Give app time to render initial UI
Start-Sleep -Seconds 5

$urls = @(
  # Release-safe smoke route (handled by App.js)
  "blyp://smoke-open-live",
  # Preferred (simple) live route
  "blyp://live",
  # E2E host route (handled only when the app opts-in)
  "blyp://e2e-live-host?title=SMOKE"
)

foreach ($u in $urls) {
  "--- am start VIEW $u ---" | Out-File -Encoding utf8 $autoOpenLog -Append
  (adb -s $Serial shell am start -W -a android.intent.action.VIEW -d "$u" 2>&1) | Out-File -Encoding utf8 $autoOpenLog -Append
  Start-Sleep -Seconds 2
}

# If deep links don't route in release builds, fall back to UI-driven flow.
# This is still fully automated (no human interaction) but requires credentials.
$email = [string]$env:BLYP_SMOKE_EMAIL
$pass = [string]$env:BLYP_SMOKE_PASSWORD
if ($email -and $pass) {
  "UI_LOGIN_START=$(Get-Date -Format o)" | Out-File -Encoding utf8 $autoOpenLog -Append

  $dump1 = Join-Path $root "04b_ui_dump_1.xml"
  $xml1 = Get-BlypUiDump -Serial $Serial -OutFile $dump1

  # Switch to Log In mode (default screen is Create Account)
  $logInNodes = Find-NodesByText -Xml $xml1 -Text "Log In"
  if ($logInNodes -and $logInNodes.Count -gt 0) {
    # Choose the lowest 'Log In' on screen (likely the toggle)
    $chosen = $null
    $chosenTop = -1
    foreach ($n in $logInNodes) {
      $b = Parse-AndroidBounds -Bounds $n.bounds
      if ($b -and $b.T -gt $chosenTop) { $chosenTop = $b.T; $chosen = $n }
    }
    if ($chosen) {
      "UI_TAP_TOGGLE_LOGIN bounds=$($chosen.bounds)" | Out-File -Encoding utf8 $autoOpenLog -Append
      Tap-Bounds -Serial $Serial -Bounds $chosen.bounds | Out-Null
      Start-Sleep -Seconds 1
    }
  }

  $dump2 = Join-Path $root "04b_ui_dump_2.xml"
  $xml2 = Get-BlypUiDump -Serial $Serial -OutFile $dump2
  $edits = Find-NodesByClass -Xml $xml2 -Class "android.widget.EditText"
  if ($edits -and $edits.Count -ge 2) {
    "UI_EDITTEXTS count=$($edits.Count)" | Out-File -Encoding utf8 $autoOpenLog -Append
    # Email
    Tap-Bounds -Serial $Serial -Bounds $edits[0].bounds | Out-Null
    Start-Sleep -Milliseconds 300
    adb -s $Serial shell input text "$(Sanitize-AdbInputText -Text $email)" 2>&1 | Out-Null
    Start-Sleep -Milliseconds 300
    # Password
    Tap-Bounds -Serial $Serial -Bounds $edits[1].bounds | Out-Null
    Start-Sleep -Milliseconds 300
    adb -s $Serial shell input text "$(Sanitize-AdbInputText -Text $pass)" 2>&1 | Out-Null
    Start-Sleep -Milliseconds 300

    # Tap the largest 'Log In' (likely the submit button)
    $dump3 = Join-Path $root "04b_ui_dump_3.xml"
    $xml3 = Get-BlypUiDump -Serial $Serial -OutFile $dump3
    $logInNodes2 = Find-NodesByText -Xml $xml3 -Text "Log In"
    if ($logInNodes2 -and $logInNodes2.Count -gt 0) {
      $submit = $null
      $bestArea = -1
      foreach ($n in $logInNodes2) {
        $b = Parse-AndroidBounds -Bounds $n.bounds
        if ($b -and $b.Area -gt $bestArea) { $bestArea = $b.Area; $submit = $n }
      }
      if ($submit) {
        "UI_TAP_SUBMIT_LOGIN bounds=$($submit.bounds)" | Out-File -Encoding utf8 $autoOpenLog -Append
        Tap-Bounds -Serial $Serial -Bounds $submit.bounds | Out-Null
        Start-Sleep -Seconds 6
      }
    }

    # Try to open plus-menu and tap Go Live (best-effort)
    $wm = (adb -s $Serial shell wm size 2>&1 | Out-String)
    $m = [regex]::Match($wm, "Physical size:\s*(\d+)x(\d+)")
    if ($m.Success) {
      $w = [int]$m.Groups[1].Value
      $h = [int]$m.Groups[2].Value
      $x = [int]($w/2)
      $y = [int]($h - 40)
      "UI_TAP_PLUS x=$x y=$y" | Out-File -Encoding utf8 $autoOpenLog -Append
      adb -s $Serial shell input tap $x $y 2>&1 | Out-Null
      Start-Sleep -Seconds 1

      $dump4 = Join-Path $root "04b_ui_dump_4.xml"
      $xml4 = Get-BlypUiDump -Serial $Serial -OutFile $dump4
      $goLiveNodes = Find-NodesByText -Xml $xml4 -Text "Go Live"
      if ($goLiveNodes -and $goLiveNodes.Count -gt 0) {
        # Choose largest 'Go Live' (button label)
        $gl = $null
        $best = -1
        foreach ($n in $goLiveNodes) {
          $b = Parse-AndroidBounds -Bounds $n.bounds
          if ($b -and $b.Area -gt $best) { $best = $b.Area; $gl = $n }
        }
        if ($gl) {
          "UI_TAP_GO_LIVE bounds=$($gl.bounds)" | Out-File -Encoding utf8 $autoOpenLog -Append
          Tap-Bounds -Serial $Serial -Bounds $gl.bounds | Out-Null
          Start-Sleep -Seconds 5
        }
      } else {
        "UI_GO_LIVE_NOT_FOUND" | Out-File -Encoding utf8 $autoOpenLog -Append
      }
    }
  } else {
    "UI_EDITTEXTS_NOT_FOUND" | Out-File -Encoding utf8 $autoOpenLog -Append
  }

  "UI_LOGIN_END=$(Get-Date -Format o)" | Out-File -Encoding utf8 $autoOpenLog -Append
} else {
  "UI_LOGIN_SKIPPED (set BLYP_SMOKE_EMAIL/BLYP_SMOKE_PASSWORD)" | Out-File -Encoding utf8 $autoOpenLog -Append
}

"AUTO_OPEN_END=$(Get-Date -Format o)" | Out-File -Encoding utf8 $autoOpenLog -Append

# Allow time for navigation/render side-effects to occur within the capture window
Start-Sleep -Seconds 5
# ---------------------------------------------------

Start-Sleep -Seconds $DurationSec

# Capture a screenshot for deterministic proof (works even if JS logs are suppressed in release)
$screen = Join-Path $root "09_screen.png"
try {
  $remoteScreen = "/sdcard/blyp_smoke_screen.png"
  adb -s $Serial shell screencap -p $remoteScreen 2>&1 | Out-Null
  adb -s $Serial pull $remoteScreen $screen 2>&1 | Out-Null
} catch {}

# Dump UI hierarchy to capture any on-screen smoke/probe overlay text
$uiXml = Join-Path $root "10_ui_dump.xml"
try {
  $remoteUi = "/sdcard/blyp_smoke_ui.xml"
  adb -s $Serial shell uiautomator dump $remoteUi 2>&1 | Out-Null
  adb -s $Serial pull $remoteUi $uiXml 2>&1 | Out-Null
} catch {}

# Extract evidence from UI dump (best-effort)
$uiEvidence = Join-Path $root "11_ui_evidence.txt"
try {
  if (Test-Path -LiteralPath $uiXml) {
    $hits = Select-String -Path $uiXml -Pattern "\[BLYP\]\[SMOKE\]" -ErrorAction SilentlyContinue
    if ($hits) {
      $hits | Select-Object -First 40 | ForEach-Object { $_.Line } | Set-Content -LiteralPath $uiEvidence
    } else {
      'NO_UI_EVIDENCE' | Set-Content -LiteralPath $uiEvidence
    }
  } else {
    'NO_UI_DUMP' | Set-Content -LiteralPath $uiEvidence
  }
} catch {
  'UI_EVIDENCE_ERROR' | Set-Content -LiteralPath $uiEvidence
}

$logcat = Join-Path $root "05_logcat.txt"
adb -s $Serial logcat -d -v threadtime 2>&1 | Out-File -Encoding utf8 $logcat

# Probe extraction (best-effort): helps prove LiveStreamScreen executed.
$probeHits = Select-String -Path $logcat -Pattern "\[BLYP\]\[PROBE\]\[addListener\]" -ErrorAction SilentlyContinue
if ($probeHits) {
  $probeHits | Select-Object -First 60 | Out-String | Out-File -Encoding utf8 (Join-Path $root "07_probe_hits.txt")
} else {
  "NO_PROBE_HITS" | Out-File -Encoding utf8 (Join-Path $root "07_probe_hits.txt")
}

# Extract smoke-hook hits (release-safe marker)
$smokeHits = Select-String -Path $logcat -Pattern '\[BLYP\]\[SMOKE\]' -SimpleMatch -ErrorAction SilentlyContinue
if ($smokeHits) {
  $smokeHits | ForEach-Object { $_.Line } | Set-Content -LiteralPath (Join-Path $root '08_smoke_hits.txt')
} else {
  'NO_SMOKE_HITS' | Set-Content -LiteralPath (Join-Path $root '08_smoke_hits.txt')
}

# Fail on strong crash/fatal signals for the target app only (ignore other packages on device).
$bad = Select-String -Path $logcat -Pattern @(
  "FATAL EXCEPTION",
  "Fatal signal",
  "SIGSEGV|SIGABRT",
  "AndroidRuntime.*FATAL",
  "Unhandled JS Exception",
  "Invariant Violation",
  "ReferenceError:",
  "TypeError:\s+Cannot read propert(y|ies)"
) -ErrorAction SilentlyContinue | Where-Object {
  $line = $_.Line
  $line -match [regex]::Escape($Package) -or $line -match 'ReactNativeJS'
}

if ($bad) {
  $bad | Select-Object -First 60 | Out-String | Out-File -Encoding utf8 (Join-Path $root "06_fail_hits.txt")
  throw "SMOKE FAIL on $Serial (fatal patterns found). Root=$root"
}

"SMOKE_PASS_ROOT=$root" | Out-File -Encoding utf8 (Join-Path $root "PASS.txt")
Write-Host "SMOKE_PASS_ROOT=$root"
exit 0
