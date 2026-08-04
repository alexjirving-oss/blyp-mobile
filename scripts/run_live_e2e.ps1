param(
  [string]$Root = "C:\Users\Alex\Blyp26",
  [string]$HostSerial = "",
  [string]$ViewerSerial = "",
  [ValidateSet("auto","service","functions","none")] [string]$BackendMode = "auto",
  [switch]$RebuildInstall,
  [switch]$ForceKillExisting,
  [switch]$KeepServers,
  [switch]$StartServersOnly,
  [switch]$SkipServerStart,
  # Step-mode: only bring up Dev Client + login on HOST, then stop.
  [switch]$HostLoginOnly,
  # Step-mode: bring up Dev Client + login on HOST, then login on VIEWER, then stop.
  [switch]$LoginBothOnly,
  # Step-mode: bring up Dev Client + login on HOST, then trigger Go Live on HOST, then stop.
  [switch]$HostGoLiveOnly,
  # Step-mode: login on HOST, login on VIEWER, then trigger Go Live on HOST, then stop.
  [switch]$LoginBothThenHostGoLiveOnly,
  [int]$DurationSec = 90,
  [int]$DevClientSettleSec = 10,
  # Viewer join can be flaky; keep retries bounded and avoid 10-minute stalls.
  [int]$ViewerJoinDeadlineSec = 240,
  # UI automation is expensive (uiautomator dumps). Only do it every N attempts.
  [int]$ViewerJoinUiEvery = 3,
  [string]$HostEmail = "",
  [string]$HostPassword = "",
  [string]$ViewerEmail = "",
  [string]$ViewerPassword = ""
)

$stepModeCount = 0
if ($HostLoginOnly) { $stepModeCount++ }
if ($LoginBothOnly) { $stepModeCount++ }
if ($HostGoLiveOnly) { $stepModeCount++ }
if ($LoginBothThenHostGoLiveOnly) { $stepModeCount++ }
if ($stepModeCount -gt 1) {
  throw "Invalid args: step modes are mutually exclusive (-HostLoginOnly, -LoginBothOnly, -HostGoLiveOnly, -LoginBothThenHostGoLiveOnly)."
}

if (($LoginBothOnly -or $LoginBothThenHostGoLiveOnly) -and (-not $ViewerSerial -or $ViewerSerial -eq "")) {
  throw "Invalid args: this mode requires -ViewerSerial"
}

# Apply step-mode gating BEFORE any output or device operations.
if ($HostLoginOnly) {
  # Ensure we never touch the viewer device in this mode.
  $ViewerSerial = ""
}
if ($HostGoLiveOnly) {
  # Ensure we never touch the viewer device in this mode.
  $ViewerSerial = ""
}
if ($LoginBothThenHostGoLiveOnly) {
  # Requires viewer; do not override ViewerSerial here.
}

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$script:ExitCode = 0
$script:LastStep = "startup"
$script:Interrupted = $false
function Fail($msg) { $script:ExitCode = 1; throw $msg }
function Info($msg) { Write-Host "INFO: $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "OK: $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "WARN: $msg" -ForegroundColor Yellow }

function Set-Step([string]$Step) {
  if ($Step -and $Step -ne $script:LastStep) {
    $script:LastStep = $Step
    Info "STEP -> $Step"
  }
}

trap [System.Management.Automation.PipelineStoppedException] {
  $script:Interrupted = $true
  if ($script:ExitCode -eq 0) { $script:ExitCode = 130 }
  Warn "INTERRUPTED by user during step: $($script:LastStep)"
  try {
    if ($runDir) {
      $p = Join-Path $runDir "interrupted.txt"
      "Interrupted during step: $($script:LastStep)" | Set-Content -LiteralPath $p -Encoding UTF8
    }
  } catch {}
  break
}

trap [System.OperationCanceledException] {
  $script:Interrupted = $true
  if ($script:ExitCode -eq 0) { $script:ExitCode = 130 }
  Warn "CANCELED during step: $($script:LastStep)"
  try {
    if ($runDir) {
      $p = Join-Path $runDir "interrupted.txt"
      "Canceled during step: $($script:LastStep)" | Set-Content -LiteralPath $p -Encoding UTF8
    }
  } catch {}
  break
}

function UrlEncode([string]$s) {
  if ($null -eq $s) { return "" }
  return [System.Uri]::EscapeDataString([string]$s)
}

function Adb([string[]]$AdbArgs) {
  & $adbExe @AdbArgs
}

function Invoke-AdbCaptureWithTimeout([string[]]$AdbArgs, [int]$TimeoutMs = 4000) {
  $tmpOut = [System.IO.Path]::GetTempFileName()
  $tmpErr = [System.IO.Path]::GetTempFileName()
  try {
    $p = Start-Process -FilePath $adbExe -ArgumentList $AdbArgs -NoNewWindow -PassThru -RedirectStandardOutput $tmpOut -RedirectStandardError $tmpErr
    if (-not $p.WaitForExit($TimeoutMs)) {
      try { $p.Kill() } catch {}
      return @()
    }
    if (Test-Path -LiteralPath $tmpOut) {
      return @(Get-Content -LiteralPath $tmpOut -ErrorAction SilentlyContinue)
    }
    return @()
  } finally {
    Remove-Item -LiteralPath $tmpOut,$tmpErr -Force -ErrorAction SilentlyContinue
  }
}

function Clear-Logcat([string]$Serial) {
  try { $null = Invoke-AdbCaptureWithTimeout @("-s",$Serial,"logcat","-c") 3500 } catch {}
}

function Get-LogcatDump([string]$Serial) {
  try {
    # IMPORTANT: avoid dumping the entire buffer repeatedly; it can become huge and stall.
    # Use a tail count with a short timeout.
    $lines = Invoke-AdbCaptureWithTimeout @("-s",$Serial,"logcat","-d","-v","time","-t","2000") 4500
    if ($lines -and $lines.Count -gt 0) { return $lines }

    # Fallback when -t isn't supported (older logcat). Still use a timeout.
    return Invoke-AdbCaptureWithTimeout @("-s",$Serial,"logcat","-d","-v","time") 4500
  } catch {
    return @()
  }
}

function Get-RecentLinesFromFile([string]$Path, [int]$Tail = 2000) {
  try {
    if (Test-Path -LiteralPath $Path) {
      return @(Get-Content -LiteralPath $Path -Tail $Tail -ErrorAction SilentlyContinue)
    }
  } catch {}
  return @()
}

function Get-LastMatchingIndex([string[]]$Lines, [string]$RegexPattern) {
  if (-not $Lines) { return -1 }
  $last = -1
  for ($i = 0; $i -lt $Lines.Count; $i++) {
    if ($Lines[$i] -match $RegexPattern) { $last = $i }
  }
  return $last
}

function Wait-LogcatPattern([string]$Serial, [string]$Pattern, [int]$Seconds, [string]$Label) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    $dump = Get-LogcatDump $Serial
    $hit = $dump | Select-String -Pattern $Pattern -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($hit) { Ok "${Label}: matched '$Pattern'"; return $hit.Line }
    Start-Sleep -Milliseconds 750
  }
  Fail "${Label}: timed out waiting for '$Pattern'"
}

function Wait-FilePattern([string]$Path, [string]$Pattern, [int]$Seconds, [string]$Label) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-Path -LiteralPath $Path) {
      $tail = Get-Content -LiteralPath $Path -Tail 400 -ErrorAction SilentlyContinue
      $hit = $tail | Select-String -Pattern $Pattern -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($hit) { Ok "${Label}: matched '$Pattern'"; return $hit.Line }
    }
    Start-Sleep -Milliseconds 750
  }
  Fail "${Label}: timed out waiting for '$Pattern' in $Path"
}

function Capture-Screenshot([string]$Serial, [string]$OutPng) {
  $dir = Split-Path -Parent $OutPng
  if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $cmd = "`"$adbExe`" -s `"$Serial`" exec-out screencap -p > `"$OutPng`""
  cmd /c $cmd | Out-Null
}

function DeepLink([string]$Serial, [string]$Url) {
  $safe = "$Url"
  # Redact secrets from logs (both raw and URL-encoded forms).
  # Example we must handle: ...deeplink=...password%3dSuperSecret!
  $safe = [regex]::Replace($safe, '(?i)(password=)(.*?)(?=(&|$))' , '${1}***')
  $safe = [regex]::Replace($safe, '(?i)(passwd=)(.*?)(?=(&|$))' , '${1}***')
  $safe = [regex]::Replace($safe, '(?i)(pwd=)(.*?)(?=(&|$))' , '${1}***')

  # Handle single-encoded and double-encoded equals (%3d / %253d)
  # NOTE: inside a URL-encoded payload, parameter separators are often encoded as %26, not '&'.
  $safe = [regex]::Replace($safe, '(?i)(password(?:%25)?%3d)(.*?)(?=(&|%26|$))' , '${1}***')
  $safe = [regex]::Replace($safe, '(?i)(passwd(?:%25)?%3d)(.*?)(?=(&|%26|$))' , '${1}***')
  $safe = [regex]::Replace($safe, '(?i)(pwd(?:%25)?%3d)(.*?)(?=(&|%26|$))' , '${1}***')
  Info "DEEPLINK[$Serial] $safe"

  # Capture am start output so failures are visible (some devices silently ignore the deep link).
  $out = @()
  # IMPORTANT: URLs contain '&' which the device shell treats as a control operator unless quoted.
  # Quote the URL so the full query reaches the app.
  $escapedUrl = $Url -replace '"', '\\"'
  $cmd = "am start -W -a android.intent.action.VIEW -d `"$escapedUrl`""
  try {
    $out = @(Adb @("-s",$Serial,"shell",$cmd) 2>$null)
  } catch {
    $out = @("am start failed: $($_.Exception.Message)")
  }
  if ($out -and $out.Count -gt 0) {
    $joined = ($out -join "\n")
    # "Activity not started... delivered to top-most instance" is normal; don't flag it as a failure.
    if ($joined -match "Error:|unable to resolve|No Activity found") {
      Info "DEEPLINK[$Serial] am start failure:\n$joined"
    }
  }
  return $out
}

function Wait-ResumedActivityContains([string]$Serial, [string]$Needle, [int]$Seconds, [string]$Label) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    $dump = ""
    try {
      $dump = (Adb @("-s",$Serial,"shell","dumpsys","activity","activities") 2>$null | Out-String)
    } catch {
      $dump = ""
    }

    $line = ($dump -split "`r?`n" | Where-Object { $_ -match "mResumedActivity|ResumedActivity|mFocusedApp|mFocusedActivity" } | Select-Object -First 1)
    if ($line -and $line -match [regex]::Escape($Needle)) {
      Ok "${Label}: resumed activity contains '$Needle'"
      return $true
    }
    Start-Sleep -Milliseconds 650
  }
  Warn "${Label}: timed out waiting for resumed activity to contain '$Needle'"
  return $false
}

function Grant-RuntimePermissions([string]$Serial, [string]$PackageName) {
  # Best-effort: these succeed only on debuggable builds / when allowed by device policy.
  $perms = @(
    "android.permission.CAMERA",
    "android.permission.RECORD_AUDIO",
    "android.permission.BLUETOOTH_CONNECT",
    "android.permission.POST_NOTIFICATIONS"
  )
  foreach ($p in $perms) {
    try { Adb @("-s",$Serial,"shell","pm","grant",$PackageName,$p) 2>$null | Out-Null } catch {}
  }
  # AppOps fallback (some OEM ROMs behave better with these set).
  try { Adb @("-s",$Serial,"shell","appops","set",$PackageName,"CAMERA","allow") 2>$null | Out-Null } catch {}
  try { Adb @("-s",$Serial,"shell","appops","set",$PackageName,"RECORD_AUDIO","allow") 2>$null | Out-Null } catch {}
}

function Try-AcceptRuntimePermissions([string]$Serial, [int]$Seconds, [string]$Label) {
  # Taps common permission dialog buttons (PermissionController / OEM variants).
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    $hit = $false

    # Most common first: "While using the app" then "Allow".
    if (Find-And-TapText $Serial @(
        "While using the app",
        "Allow while using the app",
        "Allow only while using the app",
        "Only this time",
        "Allow"
      ) 1 "${Label} PERM") { $hit = $true }

    # Some OEM dialogs / follow-ups.
    if (Find-And-TapText $Serial @(
        "OK",
        "Continue",
        "Got it"
      ) 1 "${Label} PERM") { $hit = $true }

    if (-not $hit) { break }
    Start-Sleep -Milliseconds 350
  }
}

function Try-XmlFromUiautomator([string]$Serial) {
  # Returns the dumped UI XML (string) or $null.
  try {
    $null = Invoke-AdbCaptureWithTimeout @("-s",$Serial,"shell","uiautomator","dump","--compressed","/sdcard/uidump.xml") 4500
    $xmlLines = Invoke-AdbCaptureWithTimeout @("-s",$Serial,"exec-out","cat","/sdcard/uidump.xml") 4500
    $xml = ($xmlLines -join "`n")
    if ($xml -and $xml.Trim().StartsWith("<?xml")) { return $xml }
  } catch {}
  try {
    $null = Invoke-AdbCaptureWithTimeout @("-s",$Serial,"shell","uiautomator","dump","/sdcard/uidump.xml") 4500
    $xmlLines = Invoke-AdbCaptureWithTimeout @("-s",$Serial,"exec-out","cat","/sdcard/uidump.xml") 4500
    $xml = ($xmlLines -join "`n")
    if ($xml -and $xml.Trim().StartsWith("<?xml")) { return $xml }
  } catch {}
  return $null
}

function Try-ViewerJoinViaUi([string]$Serial, [string]$E2ETitle, [string]$RunDir) {
  # UI flow per device guidance:
  # Bottom tab: Chat/Games -> header tab: Live -> tap the broadcast in the list.
  # Best-effort taps with multiple label variants.
  Info "VIEWER: attempting UI join flow (Chat/Games -> Live -> tap broadcast)"

  # 1) Bottom tab: Chat/Games
  $ok = Find-And-TapText $Serial @('Chat games','Chat Games','Chat','Games') 20 'VIEWER NAV TAB'
  if (-not $ok) {
    Warn "VIEWER: could not find Chat/Games tab text; continuing"
  }
  Start-Sleep -Milliseconds 500

  # 2) Header tab: Live
  $okLiveTab = Find-And-TapText $Serial @('Live','LIVE') 20 'VIEWER NAV LIVE_TAB'
  if (-not $okLiveTab) {
    Warn "VIEWER: could not find Live header tab; continuing"
  }
  Start-Sleep -Milliseconds 700

  # 2b) Some builds show a secondary tab/list like "Broadcasters" / "Broadcaster" before the live cards.
  # Tap it if present, then proceed to selecting a live item.
  $null = Find-And-TapText $Serial @('Broadcasters','Broadcaster','Creators','Creator') 6 'VIEWER NAV BROADCASTERS_TAB'
  Start-Sleep -Milliseconds 450

  # 3) Tap the broadcast card.
  # Prefer exact title, then a generic "E2E" marker, then "LIVE".
  $tapped = $false
  for ($i = 0; $i -lt 4 -and -not $tapped; $i++) {
    if ($E2ETitle) {
      $tapped = Find-And-TapText $Serial @($E2ETitle) 6 'VIEWER TAP BROADCAST_TITLE'
    }
    if (-not $tapped) {
      $tapped = Find-And-TapText $Serial @('E2E') 6 'VIEWER TAP BROADCAST_E2E'
    }
    if (-not $tapped) {
      $tapped = Find-And-TapText $Serial @('LIVE','Live') 6 'VIEWER TAP BROADCAST_LIVE'
    }

    # Some UIs expose the live entry as a button-like row labeled "LIVE" (sometimes repeated in the card).
    if (-not $tapped) {
      $tapped = Find-And-TapText $Serial @('Live now','LIVE NOW','Watch Live','Watch live') 6 'VIEWER TAP BROADCAST_WATCH'
    }

    if (-not $tapped) {
      # If the card doesn't expose the title as a text node, fall back to tapping a large clickable card.
      $tapped = Try-TapBroadcastCardFallback $Serial $E2ETitle 'VIEWER TAP BROADCAST_FALLBACK'
    }

    if (-not $tapped -and $i -lt 3) {
      # Scroll the list and retry. Coordinates are best-effort and should work on most phones.
      try {
        Info "VIEWER: broadcast not found yet; scrolling list (attempt $($i + 1))"
        Swipe $Serial 500 1650 500 650 300
        Start-Sleep -Milliseconds 650
      } catch {}
    }
  }

  $ts = (Get-Date).ToString('HHmmss')
  Capture-Screenshot $Serial (Join-Path $RunDir "viewer_after_ui_join_attempt_${ts}.png")
  $null = Save-UiDump $Serial (Join-Path $RunDir "viewer_after_ui_join_attempt_${ts}.xml")

  if ($tapped) {
    Fail-FastIfCrashAfterTap $Serial 'viewer' $RunDir 10
  }

  return $tapped
}

function Try-ViewerNavigateToLiveTabViaUi([string]$Serial, [string]$E2ETitle, [string]$RunDir) {
  Info "VIEWER: pre-navigating UI (Chat/Games -> Live tab -> tap broadcast)"
  $ok = Find-And-TapText $Serial @('Chat games','Chat Games','Chat','Games') 12 'VIEWER NAV TAB'
  Start-Sleep -Milliseconds 500
  $okLiveTab = Find-And-TapText $Serial @('Live','LIVE') 12 'VIEWER NAV LIVE_TAB'

  # Best-effort: try tapping the broadcaster immediately so the UI definitely progresses.
  $tapped = $false
  if ($E2ETitle) {
    $tapped = Find-And-TapText $Serial @($E2ETitle,'E2E') 3 'VIEWER PRE TAP'
  }
  if (-not $tapped) {
    $tapped = Try-TapBroadcastCardFallback $Serial $E2ETitle 'VIEWER PRE TAP'
  }

  $ts = (Get-Date).ToString('HHmmss')
  Capture-Screenshot $Serial (Join-Path $RunDir "viewer_pre_live_tab_${ts}.png")
  $null = Save-UiDump $Serial (Join-Path $RunDir "viewer_pre_live_tab_${ts}.xml")

  if ($tapped) {
    Fail-FastIfCrashAfterTap $Serial 'viewer' $RunDir 10
  }

  return ($ok -or $okLiveTab -or $tapped)
}

function Wait-ViewerLiveScreen([string]$Serial, [int]$Seconds, [string]$Label) {
  # We only consider the viewer "ready" once the LiveStreamScreen is actually opened in viewer mode.
  # This avoids false positives where stage join succeeds in background but UI stays on Home.
  return Wait-LogcatPattern $Serial "\\[LIVE\\]\\[MODE_RESOLVED\\].*mode:\\s*'viewer'" $Seconds $Label
}

function Get-BoundsCenter([string]$bounds) {
  # bounds format: [l,t][r,b]
  $m = [regex]::Match($bounds, '\[(\d+),(\d+)\]\[(\d+),(\d+)\]')
  if (-not $m.Success) { return $null }
  $l = [int]$m.Groups[1].Value
  $t = [int]$m.Groups[2].Value
  $r = [int]$m.Groups[3].Value
  $b = [int]$m.Groups[4].Value
  $x = [int](($l + $r) / 2)
  $y = [int](($t + $b) / 2)
  return @{ x = $x; y = $y }
}

$script:DeviceSizeCache = @{}
function Get-DevicePhysicalSize([string]$Serial) {
  if ($script:DeviceSizeCache.ContainsKey($Serial)) { return $script:DeviceSizeCache[$Serial] }
  $w = 1080
  $h = 1920
  try {
    $out = Invoke-AdbCaptureWithTimeout @("-s",$Serial,"shell","wm","size") 2500
    $text = ($out -join " ")
    $m = [regex]::Match($text, '(?i)(Physical\s*size|Override\s*size)\s*:\s*(\d+)x(\d+)')
    if ($m.Success) {
      $w = [int]$m.Groups[2].Value
      $h = [int]$m.Groups[3].Value
    }
  } catch {}
  $size = @{ w = $w; h = $h }
  $script:DeviceSizeCache[$Serial] = $size
  return $size
}

function Try-TapBottomCenterClickableFromXml([string]$Serial, [string]$Label) {
  # Some UI affordances (e.g. the bottom-center "+" create button) are clickable nodes with no text/content-desc.
  # This finds a bottom-center clickable node from UIAutomator XML and taps its bounds center.
  $xml = $null
  try { $xml = Try-XmlFromUiautomator $Serial } catch { $xml = $null }
  if (-not $xml) { return $false }

  $size = Get-DevicePhysicalSize $Serial
  if (-not $size -or $size.w -le 0 -or $size.h -le 0) { return $false }
  $w = [int]$size.w
  $h = [int]$size.h

  $minY = [int]([Math]::Round($h * 0.72))
  $maxY = [int]([Math]::Round($h * 0.985))
  $minX = [int]([Math]::Round($w * 0.30))
  $maxX = [int]([Math]::Round($w * 0.70))

  $minArea = [int]([Math]::Round($w * $h * 0.0015))
  $maxArea = [int]([Math]::Round($w * $h * 0.03))
  $expectedArea = [double]($w * $h * 0.006)

  $best = $null
  $bestScore = -1

  foreach ($m in [regex]::Matches($xml, '<node\b[^>]*>')) {
    $s = $m.Value
    if ($s -notmatch 'clickable="true"') { continue }
    if ($s -match 'enabled="false"') { continue }

    $bounds = $null
    if ($s -match 'bounds="([^"]+)"') { $bounds = $matches[1] }
    if (-not $bounds) { continue }

    $bm = [regex]::Match($bounds, '\[(\d+),(\d+)\]\[(\d+),(\d+)\]')
    if (-not $bm.Success) { continue }
    $l = [int]$bm.Groups[1].Value
    $t = [int]$bm.Groups[2].Value
    $r = [int]$bm.Groups[3].Value
    $b = [int]$bm.Groups[4].Value
    $nodeW = ($r - $l)
    $nodeH = ($b - $t)
    if ($nodeW -le 0 -or $nodeH -le 0) { continue }

    $cx = [int](($l + $r) / 2)
    $cy = [int](($t + $b) / 2)
    if ($cy -lt $minY -or $cy -gt $maxY) { continue }
    if ($cx -lt $minX -or $cx -gt $maxX) { continue }

    # Exclude large containers (bottom sheets / full-width bars).
    if ($nodeW -gt [int]($w * 0.65)) { continue }
    if ($nodeH -gt [int]($h * 0.35)) { continue }

    $area = $nodeW * $nodeH
    if ($area -lt $minArea -or $area -gt $maxArea) { continue }

    $text = ''
    $desc = ''
    $rid = ''
    $cls = ''
    if ($s -match 'text="([^"]*)"') { $text = $matches[1] }
    if ($s -match 'content-desc="([^"]*)"') { $desc = $matches[1] }
    if ($s -match 'resource-id="([^"]*)"') { $rid = $matches[1] }
    if ($s -match 'class="([^"]*)"') { $cls = $matches[1] }

    $dx = [double][Math]::Abs($cx - ($w / 2))
    $dy = [double][Math]::Abs($cy - ($h * 0.90))
    $score = 0

    # Prefer close to bottom-center.
    $score += [int](600 - [Math]::Min(600.0, $dx))
    $score += [int](400 - [Math]::Min(400.0, $dy))

    # Prefer unlabeled nodes (this matches the observed "+" node).
    if ([string]::IsNullOrWhiteSpace($text) -and [string]::IsNullOrWhiteSpace($desc)) {
      $score += 250
    } else {
      $score -= 75
    }

    # Prefer a reasonable button-ish area.
    $areaDelta = [double][Math]::Abs($area - $expectedArea)
    $areaPenalty = [Math]::Min(250.0, ($areaDelta / [Math]::Max(1.0, $expectedArea)) * 250.0)
    $score += [int](250 - $areaPenalty)

    if ($rid -match '(?i)(create|plus|add|new)') { $score += 150 }
    if ($cls -match '(?i)(ImageButton|Button)') { $score += 40 }

    if ($score -gt $bestScore) {
      $bestScore = $score
      $best = @{ x = $cx; y = $cy; bounds = $bounds; score = $score }
    }
  }

  if (-not $best) { return $false }
  Info "${Label}: XML fallback tapping bottom-center clickable at ($($best.x),$($best.y)) score=$($best.score) bounds=$($best.bounds)"
  try {
    Tap $Serial $best.x $best.y
    return $true
  } catch {
    return $false
  }
}

function Try-TapBroadcastCardFallback([string]$Serial, [string]$E2ETitle, [string]$Label) {
  # When the broadcast card doesn't include the title text as a node, Find-And-TapText won't work.
  # Fallback: tap the first "large clickable" item in the mid-screen list area.
  $xml = $null
  try { $xml = Try-XmlFromUiautomator $Serial } catch { $xml = $null }
  if (-not $xml) { return $false }

  $size = Get-DevicePhysicalSize $Serial
  $w = [int]$size.w
  $h = [int]$size.h
  $minY = [int]($h * 0.22)  # below top tabs
  $maxY = [int]($h * 0.82)  # above bottom nav
  $minArea = [int]($w * $h * 0.035)

  $best = $null
  $bestScore = -1
  foreach ($m in [regex]::Matches($xml, '<node\b[^>]*>')) {
    $s = $m.Value
    if ($s -notmatch 'clickable="true"') { continue }
    $bounds = $null
    if ($s -match 'bounds="([^"]+)"') { $bounds = $matches[1] }
    if (-not $bounds) { continue }

    $bm = [regex]::Match($bounds, '\[(\d+),(\d+)\]\[(\d+),(\d+)\]')
    if (-not $bm.Success) { continue }
    $l = [int]$bm.Groups[1].Value
    $t = [int]$bm.Groups[2].Value
    $r = [int]$bm.Groups[3].Value
    $b = [int]$bm.Groups[4].Value
    $area = ($r - $l) * ($b - $t)
    if ($area -lt $minArea) { continue }

    $cx = [int](($l + $r) / 2)
    $cy = [int](($t + $b) / 2)
    if ($cy -lt $minY -or $cy -gt $maxY) { continue }

    $text = ''
    $desc = ''
    if ($s -match 'text="([^"]*)"') { $text = $matches[1] }
    if ($s -match 'content-desc="([^"]*)"') { $desc = $matches[1] }

    $score = 0
    if ($E2ETitle -and (($text -like "*$E2ETitle*") -or ($desc -like "*$E2ETitle*"))) { $score += 1000 }
    if (($text -match '(?i)\bE2E\b') -or ($desc -match '(?i)\bE2E\b')) { $score += 400 }
    if (($text -match '(?i)\bLIVE\b') -or ($desc -match '(?i)\bLIVE\b')) { $score += 250 }

    # Prefer larger cards and cards closer to screen center.
    $score += [Math]::Min(600, [int]($area / ($w * $h) * 6000))
    $score += [int](200 - [Math]::Min(200, [Math]::Abs($cy - ($h / 2)) / 5))

    if ($score -gt $bestScore) {
      $bestScore = $score
      $best = @{ x = $cx; y = $cy; bounds = $bounds; score = $score }
    }
  }

  if (-not $best) { return $false }
  Info "${Label}: fallback tapping broadcast-like card at ($($best.x),$($best.y)) score=$($best.score) bounds=$($best.bounds)"
  try {
    $null = Invoke-AdbCaptureWithTimeout @("-s",$Serial,"shell","input","tap","$($best.x)","$($best.y)") 1800
    return $true
  } catch {
    return $false
  }
}

function Fail-FastIfCrashAfterTap([string]$Serial, [string]$Label, [string]$RunDir, [int]$Seconds = 8) {
  # After tapping a broadcast card, the app may crash. Detect quickly and capture artifacts.
  try {
    $hit = Wait-LogcatPattern $Serial '(AndroidRuntime.*FATAL EXCEPTION|Fatal signal|JNI DETECTED ERROR|SIGABRT)' $Seconds "${Label} CRASH WATCH"
    $t = (Get-Date).ToString('HHmmss')
    Capture-Screenshot $Serial (Join-Path $RunDir "${Label}_crash_${t}.png")
    $null = Save-UiDump $Serial (Join-Path $RunDir "${Label}_crash_${t}.xml")
    Dump-DeviceState $Serial "${Label}_crash_${t}" $RunDir
    Fail "${Label}: app crashed after tapping broadcast. See artifacts in $RunDir"
  } catch {
    # no crash detected
  }
}

function Tap([string]$Serial, [int]$X, [int]$Y) {
  $null = Invoke-AdbCaptureWithTimeout @("-s",$Serial,"shell","input","tap","$X","$Y") 3500
}

function Swipe([string]$Serial, [int]$X1, [int]$Y1, [int]$X2, [int]$Y2, [int]$Ms = 250) {
  $null = Invoke-AdbCaptureWithTimeout @("-s",$Serial,"shell","input","swipe","$X1","$Y1","$X2","$Y2","$Ms") 4500
}

function Input-Text([string]$Serial, [string]$Text) {
  # input text needs escaping for spaces and some symbols
  $t = [string]$Text
  $t = $t -replace ' ', '%s'
  $t = $t -replace '\\', '\\\\'
  $null = Invoke-AdbCaptureWithTimeout @("-s",$Serial,"shell","input","text",$t) 4500
}

function Key-Event([string]$Serial, [string]$Code) {
  $null = Invoke-AdbCaptureWithTimeout @("-s",$Serial,"shell","input","keyevent",$Code) 3500
}

function Wake-Unlock-BestEffort([string]$Serial, [string]$Label) {
  Info "${Label}: waking/unlocking (best-effort)"
  try { Key-Event $Serial "KEYCODE_WAKEUP" } catch {}
  try { Swipe $Serial 500 1800 500 900 250 } catch {}
  Start-Sleep -Milliseconds 600
}


function Launch-AppBestEffort([string]$Serial, [string]$Label) {
  Info "${Label}: launching com.blyp.mobile (Dev Client)"
  try {
    $null = Invoke-AdbCaptureWithTimeout @("-s",$Serial,"shell","monkey","-p","com.blyp.mobile","-c","android.intent.category.LAUNCHER","1") 4500
  } catch {
    try {
      $null = Invoke-AdbCaptureWithTimeout @("-s",$Serial,"shell","am","start","-W","-a","android.intent.action.MAIN","-c","android.intent.category.LAUNCHER","-p","com.blyp.mobile") 6000
    } catch {
      # ignore
    }
  }
  Start-Sleep -Milliseconds 900
}

function Dump-DeviceState([string]$Serial, [string]$Label, [string]$RunDir) {
  try {
    $path = Join-Path $RunDir ("device_state_{0}_{1}.txt" -f $Label.ToLower(), $Serial)
    $lines = @()
    $lines += ("TIME=" + (Get-Date -Format "yyyy-MM-dd HH:mm:ss.fff"))
    $lines += ("SERIAL=" + $Serial)
    $lines += ("RESUMED_ACTIVITY=" + (Get-ResumedActivityLine $Serial))
    $lines += ""
    $lines += "-- dumpsys activity top (first 80 lines) --"
    $dump = Invoke-AdbCaptureWithTimeout @("-s",$Serial,"shell","dumpsys","activity","top") 4500
    $lines += @($dump | Select-Object -First 80)
    Set-Content -LiteralPath $path -Value ($lines -join "`n") -Encoding UTF8
  } catch {
    # ignore
  }
}

function Find-And-TapText([string]$Serial, [string[]]$Needles, [int]$Seconds, [string]$Label) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    $xml = Try-XmlFromUiautomator $Serial
    if ($xml) {
      foreach ($needle in $Needles) {
        # Match contains (UIA often includes extra words like "Already have an account? Log In").
        $needleEsc = [regex]::Escape($needle)
        $needlePattern = '(?:text="[^"]*' + $needleEsc + '[^"]*"|content-desc="[^"]*' + $needleEsc + '[^"]*")'

        # Prefer clickable nodes (buttons are often ViewGroups with content-desc). Attribute order is NOT stable, so use lookaheads.
        $m = [regex]::Match(
          $xml,
          '<node(?=[^>]*clickable="true")(?=[^>]*' + $needlePattern + ')[^>]*bounds="(\[[^\"]+\])"',
          'Singleline'
        )
        if (-not $m.Success) {
          $m = [regex]::Match(
            $xml,
            '<node(?=[^>]*' + $needlePattern + ')[^>]*bounds="(\[[^\"]+\])"',
            'Singleline'
          )
        }
        if ($m.Success) {
          $center = Get-BoundsCenter $m.Groups[1].Value
          if ($center) {
            Info "${Label}: tapping '$needle' at $($center.x),$($center.y)"
            Tap $Serial $center.x $center.y
            return $true
          }
        }
      }
    }
    Start-Sleep -Milliseconds 600
  }
  return $false
}

function Find-And-TapEditTextIndex([string]$Serial, [int]$Index, [int]$Seconds, [string]$Label) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    $xml = Try-XmlFromUiautomator $Serial
    if ($xml) {
      $matches = [regex]::Matches($xml, 'class="android\.widget\.EditText".*?bounds="(\[[^\"]+\])"', 'Singleline')
      if ($matches.Count -gt $Index) {
        $center = Get-BoundsCenter $matches[$Index].Groups[1].Value
        if ($center) {
          Info "${Label}: tapping EditText[$Index] at $($center.x),$($center.y)"
          Tap $Serial $center.x $center.y
          return $true
        }
      }
    }
    Start-Sleep -Milliseconds 600
  }
  return $false
}

function Save-UiDump([string]$Serial, [string]$OutPath) {
  try {
    $xml = Try-XmlFromUiautomator $Serial
    if ($xml) {
      Set-Content -LiteralPath $OutPath -Value $xml -Encoding UTF8
      return $true
    }
  } catch {}
  return $false
}

function Wait-WelcomeScreenUi([string]$Serial, [int]$Seconds, [string]$Label) {
  # UI-based readiness gate: when the app is visibly on the welcome/auth screen,
  # we can proceed immediately instead of waiting on slow Metro "Bundled" logs.
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    $xml = Try-XmlFromUiautomator $Serial
    if ($xml) {
      if ($xml -match 'text="[^"]*(Log\s*In|Login|Sign\s*Up|Create\s*Account|Already\s+have\s+an\s+account)[^"]*"' -or
          $xml -match 'content-desc="[^"]*(Log\s*In|Login|Sign\s*Up|Create\s*Account|Already\s+have\s+an\s+account)[^"]*"') {
        Ok "${Label}: welcome/auth UI detected"
        return $true
      }
    }
    Start-Sleep -Milliseconds 650
  }
  Warn "${Label}: welcome/auth UI not detected quickly"
  return $false
}

function Wait-AppReadyForE2E([string]$Serial, [int]$Seconds, [string]$Label, [string]$LogPath = "") {
  # The runner used to gate purely on a JS log line (PRELUDE). If logcat was cleared
  # while the app was already on Welcome, PRELUDE might never re-emit, causing long stalls.
  # Consider the app "ready" if either:
  #  - PRELUDE appears in logcat, OR
  #  - the welcome/auth UI is visible.
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    try {
      if ($LogPath -and (Test-Path -LiteralPath $LogPath)) {
        $tail = @(Get-Content -LiteralPath $LogPath -Tail 700 -ErrorAction SilentlyContinue)
        $hit = $tail | Select-String -Pattern 'ReactNativeJS.*\[BLYP\]\[APP\] PRELUDE\?' -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($hit) {
          Ok "${Label}: PRELUDE observed"
          return "prelude"
        }
      } else {
        # Fallback when no file capture is available.
        $dump = Get-LogcatDump $Serial
        $hit = $dump | Select-String -Pattern 'ReactNativeJS.*\[BLYP\]\[APP\] PRELUDE\?' -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($hit) {
          Ok "${Label}: PRELUDE observed"
          return "prelude"
        }
      }
    } catch {}

    try {
      $xml = Try-XmlFromUiautomator $Serial
      if ($xml -and ($xml -match 'text="[^"]*(Log\s*In|Login|Sign\s*Up|Create\s*Account|Already\s+have\s+an\s+account)[^"]*"' -or
                   $xml -match 'content-desc="[^"]*(Log\s*In|Login|Sign\s*Up|Create\s*Account|Already\s+have\s+an\s+account)[^"]*"')) {
        Ok "${Label}: welcome/auth UI visible"
        return "ui"
      }
    } catch {}

    Start-Sleep -Milliseconds 700
  }
  Warn "${Label}: timed out waiting for PRELUDE or welcome/auth UI"
  return $null
}

function Test-LoggedInUi([string]$Serial) {
  # Best-effort heuristic for "already past welcome/login" state.
  # If we see primary navigation tabs, we assume the session is logged in.
  try {
    $xml = Try-XmlFromUiautomator $Serial
    if (-not $xml) { return $false }
    if ($xml -match 'text="[^"]*(Chat\s*games|Chat\s*Games|Chat|Games|Live)[^"]*"') { return $true }
    if ($xml -match 'content-desc="[^"]*(Chat\s*games|Chat\s*Games|Chat|Games|Live)[^"]*"') { return $true }
  } catch {}
  return $false
}

function Wait-AuthSuccessOrLoggedInUi([string]$Serial, [int]$Seconds, [string]$Label, [string]$LogPath = "") {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    try {
      if ($LogPath -and (Test-Path -LiteralPath $LogPath)) {
        $tail = @(Get-Content -LiteralPath $LogPath -Tail 800 -ErrorAction SilentlyContinue)
        $hit = $tail | Select-String -Pattern "\[AUTH\]\[SUCCESS\].*password_login" -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($hit) {
          Ok "${Label}: auth success observed"
          return $true
        }
      } else {
        $dump = Get-LogcatDump $Serial
        $hit = $dump | Select-String -Pattern "\[AUTH\]\[SUCCESS\].*password_login" -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($hit) {
          Ok "${Label}: auth success observed"
          return $true
        }
      }
    } catch {}

    if (Test-LoggedInUi $Serial) {
      Ok "${Label}: logged-in UI detected"
      return $true
    }
    Start-Sleep -Milliseconds 750
  }
  return $false
}

function Try-UiLogin([string]$Serial, [string]$Email, [string]$Password, [string]$RoleLabel) {
  Info "$RoleLabel UI login fallback: navigating to Log In screen"
  $toggled = Find-And-TapText $Serial @('Already have an account','Log In','Login') 20 "$RoleLabel TOGGLE"
  # Small settle; large sleeps here slow the whole 2-device flow.
  Start-Sleep -Milliseconds 250

  # Tap Email field
  $emailTapped = Find-And-TapText $Serial @('Email') 10 "$RoleLabel EMAIL"
  if (-not $emailTapped) { $emailTapped = Find-And-TapEditTextIndex $Serial 0 10 "$RoleLabel EMAIL_FALLBACK" }
  if (-not $emailTapped) { return $false }
  Key-Event $Serial "KEYCODE_MOVE_END"
  Key-Event $Serial "KEYCODE_DEL"
  Input-Text $Serial $Email
  # Prefer tapping the next field instead of relying on TAB.
  Start-Sleep -Milliseconds 150

  # Tap Password field
  $pwTapped = Find-And-TapText $Serial @('Password') 10 "$RoleLabel PASSWORD"
  if (-not $pwTapped) { $pwTapped = Find-And-TapEditTextIndex $Serial 1 10 "$RoleLabel PASSWORD_FALLBACK" }
  if (-not $pwTapped) { return $false }
  Input-Text $Serial $Password
  Key-Event $Serial "KEYCODE_BACK"
  Start-Sleep -Milliseconds 200

  # Press the submit button (text is also 'Log In' on login mode)
  $submitted = Find-And-TapText $Serial @('Log In','Login') 15 "$RoleLabel SUBMIT"
  return $submitted
}

function Try-HostGoLiveViaUi([string]$Serial, [string]$E2ETitle, [string]$RunDir) {
  # Required host go-live flow:
  # 1) Tap plus (+) button
  # 2) Tap Go Live
  # 3) Enter title
  # 4) Tap Go Live (confirm)
  Info "HOST: go-live via UI (+ -> Go Live -> title -> Go Live)"

  # Step 1+2 combined: ensure the create sheet opens and the Go Live entry is visible.
  $goLiveEntryOk = $false
  for ($attempt = 1; $attempt -le 3 -and -not $goLiveEntryOk; $attempt++) {
    $plusOk = $false

    foreach ($needles in @(
        @('+','＋'),
        @('Create','New','Add'),
        @('New post','Create post','Post')
      )) {
      if (Find-And-TapText $Serial $needles 2 "HOST PLUS (attempt $attempt)") { $plusOk = $true; break }
    }

    if (-not $plusOk) {
      # Fallback: derive the bottom-center "+" node from UIAutomator XML (unlabeled clickable).
      $plusOk = Try-TapBottomCenterClickableFromXml $Serial "HOST PLUS (attempt $attempt)"
    }

    if (-not $plusOk) {
      # Last resort: coordinate-based tap (kept as an emergency fallback).
      try {
        $size = Get-DevicePhysicalSize $Serial
        if ($size -and $size.w -gt 0 -and $size.h -gt 0) {
          $x = [int]([Math]::Round($size.w * 0.50))
          $y = [int]([Math]::Round($size.h * 0.92))
          Info "HOST PLUS (attempt $attempt): last-resort coordinate tap at ${x},${y}"
          Tap $Serial $x $y
          $plusOk = $true
        }
      } catch {}
    }

    if (-not $plusOk) {
      $t = (Get-Date).ToString('HHmmss')
      Capture-Screenshot $Serial (Join-Path $RunDir "host_plus_button_not_found_${t}.png")
      $null = Save-UiDump $Serial (Join-Path $RunDir "host_plus_button_not_found_${t}.xml")
      Dump-DeviceState $Serial "host_plus_button_not_found_${t}" $RunDir
      return $false
    }

    # If a permission prompt appears, it can block the sheet.
    try { Handle-RuntimePermissionDialogsBestEffort $Serial "HOST" 3 } catch {}
    Start-Sleep -Milliseconds 450

    # Step 2: tap Go Live from the create menu/sheet.
    $goLiveEntryOk = Find-And-TapText $Serial @('Go Live','Go live') 4 "HOST GO_LIVE (attempt $attempt)"
    if (-not $goLiveEntryOk) {
      # Some runs need a second tap on the "+" before the sheet actually opens.
      Start-Sleep -Milliseconds 350
    }
  }

  if (-not $goLiveEntryOk) {
    $t = (Get-Date).ToString('HHmmss')
    Capture-Screenshot $Serial (Join-Path $RunDir "host_go_live_entry_not_found_${t}.png")
    $null = Save-UiDump $Serial (Join-Path $RunDir "host_go_live_entry_not_found_${t}.xml")
    Dump-DeviceState $Serial "host_go_live_entry_not_found_${t}" $RunDir
    return $false
  }
  Start-Sleep -Milliseconds 450

  # Title entry: try common labels/placeholders, then fall back to first EditText.
  $titleTapped = Find-And-TapText $Serial @('Title','Stream title','Live title','Enter title','Enter a title','Add a title') 6 'HOST TITLE'
  if (-not $titleTapped) { $titleTapped = Find-And-TapEditTextIndex $Serial 0 6 'HOST TITLE_FALLBACK' }
  if (-not $titleTapped) {
    $t = (Get-Date).ToString('HHmmss')
    Capture-Screenshot $Serial (Join-Path $RunDir "host_title_field_not_found_${t}.png")
    $null = Save-UiDump $Serial (Join-Path $RunDir "host_title_field_not_found_${t}.xml")
    Dump-DeviceState $Serial "host_title_field_not_found_${t}" $RunDir
    return $false
  }

  # Clear any existing text (best-effort) and type title.
  try { Key-Event $Serial "KEYCODE_MOVE_END" } catch {}
  try { Key-Event $Serial "KEYCODE_DEL" } catch {}
  Input-Text $Serial $E2ETitle
  try { Key-Event $Serial "KEYCODE_BACK" } catch {}
  Start-Sleep -Milliseconds 250

  # Step 4: confirm Go Live.
  if (-not (Find-And-TapText $Serial @('Go Live','Go live') 10 'HOST GO_LIVE_CONFIRM')) {
    $t = (Get-Date).ToString('HHmmss')
    Capture-Screenshot $Serial (Join-Path $RunDir "host_go_live_confirm_not_found_${t}.png")
    $null = Save-UiDump $Serial (Join-Path $RunDir "host_go_live_confirm_not_found_${t}.xml")
    Dump-DeviceState $Serial "host_go_live_confirm_not_found_${t}" $RunDir
    return $false
  }
  return $true
}

function Grant-AppRuntimePermissionsBestEffort([string]$Serial, [string]$Label) {
  # Best-effort: only succeeds for permissions declared in the app manifest.
  # This reduces the chance of a runtime permission dialog blocking the IVS host preview.
  $pkg = "com.blyp.mobile"
  $perms = @(
    "android.permission.CAMERA",
    "android.permission.RECORD_AUDIO",
    "android.permission.BLUETOOTH_CONNECT",
    "android.permission.POST_NOTIFICATIONS"
  )
  foreach ($p in $perms) {
    try {
      $null = Invoke-AdbCaptureWithTimeout @("-s",$Serial,"shell","pm","grant",$pkg,$p) 2500
    } catch {
      # ignore
    }
  }
}

function Handle-RuntimePermissionDialogsBestEffort([string]$Serial, [string]$Label, [int]$Seconds = 12) {
  # Try to dismiss/accept common Android permission prompts.
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    $tapped = $false
    foreach ($needleSet in @(
      @('While using the app','While using this app'),
      @('Allow only while using the app'),
      @('Only this time'),
      @('Allow'),
      @('OK'),
      @('Continue')
    )) {
      try {
        if (Find-And-TapText $Serial $needleSet 1 "$Label PERM") {
          $tapped = $true
          Start-Sleep -Milliseconds 350
          break
        }
      } catch {}
    }
    if (-not $tapped) { break }
  }
}

function Try-WaitFilePattern([string]$Path, [string]$Pattern, [int]$Seconds) {
  try {
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
      if (Test-Path -LiteralPath $Path) {
        $tail = Get-Content -LiteralPath $Path -Tail 400 -ErrorAction SilentlyContinue
        $hit = $tail | Select-String -Pattern $Pattern -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($hit) { return $true }
      }
      Start-Sleep -Milliseconds 750
    }
  } catch {}
  return $false
}

function Test-FilePatternAny([string]$Path, [string]$Pattern) {
  try {
    if (-not (Test-Path -LiteralPath $Path)) { return $false }
    return [bool](Select-String -Path $Path -Pattern $Pattern -Quiet -ErrorAction SilentlyContinue)
  } catch {
    return $false
  }
}

Set-Location -LiteralPath $Root

if ($StartServersOnly) {
  $KeepServers = $true
}

if ($StartServersOnly -and $SkipServerStart) {
  Fail "Invalid args: cannot use -StartServersOnly with -SkipServerStart"
}

# --- Paths ---
$art = Join-Path $Root "artifacts\live_e2e"
New-Item -ItemType Directory -Force -Path $art | Out-Null
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$runDir = Join-Path $art $ts
New-Item -ItemType Directory -Force -Path $runDir | Out-Null

# Optional: set EXPO_PUBLIC vars for the Metro process (children inherit env).
if ($HostEmail) { $env:EXPO_PUBLIC_E2E_HOST_EMAIL = $HostEmail }
if ($HostPassword) { $env:EXPO_PUBLIC_E2E_HOST_PASSWORD = $HostPassword }
if ($ViewerEmail) { $env:EXPO_PUBLIC_E2E_VIEWER_EMAIL = $ViewerEmail }
if ($ViewerPassword) { $env:EXPO_PUBLIC_E2E_VIEWER_PASSWORD = $ViewerPassword }
$env:EXPO_PUBLIC_E2E_LOGIN = "1"
$env:EXPO_PUBLIC_E2E_LIVE = "1"

$script:EnvLocalPath = Join-Path $Root ".env.local"
$script:EnvLocalBackupPath = $null
$script:EnvLocalHadOriginal = $false

function Quote-EnvValue([string]$v) {
  if ($null -eq $v) { return '""' }
  $escaped = ($v -replace "\\","\\\\") -replace '"','\\"'
  return '"' + $escaped + '"'
}

function Upsert-EnvLine([string]$content, [string]$key, [string]$value) {
  $escapedKey = [regex]::Escape($key)
  $content = [regex]::Replace($content, "(?m)^\\s*$escapedKey\\s*=.*$", "")
  $content = ($content -replace "(?m)^[\\r\\n]+", "")
  if ($content -ne "" -and -not $content.EndsWith("`n")) { $content += "`n" }
  $content += ("{0}={1}`n" -f $key, $value)
  return $content
}

function Push-E2EEnvLocal([string]$RunDir) {
  $script:EnvLocalHadOriginal = (Test-Path -LiteralPath $script:EnvLocalPath)
  $script:EnvLocalBackupPath = Join-Path $RunDir ".env.local.backup"

  if ($script:EnvLocalHadOriginal) {
    Copy-Item -LiteralPath $script:EnvLocalPath -Destination $script:EnvLocalBackupPath -Force
  }

  $content = ""
  if ($script:EnvLocalHadOriginal) {
    $content = Get-Content -LiteralPath $script:EnvLocalPath -Raw -ErrorAction SilentlyContinue
  }

  # Only enable flags. Do NOT write credentials to disk.
  $content = Upsert-EnvLine $content "EXPO_PUBLIC_E2E_LOGIN" (Quote-EnvValue "1")
  $content = Upsert-EnvLine $content "EXPO_PUBLIC_E2E_LIVE" (Quote-EnvValue "1")

  Set-Content -LiteralPath $script:EnvLocalPath -Value $content -Encoding UTF8
  try {
    $redacted = $content
    $redacted = [regex]::Replace($redacted, '(?m)^(EXPO_PUBLIC_E2E_HOST_PASSWORD\s*=\s*).+$', '$1"***"')
    $redacted = [regex]::Replace($redacted, '(?m)^(EXPO_PUBLIC_E2E_VIEWER_PASSWORD\s*=\s*).+$', '$1"***"')
    $redacted = [regex]::Replace($redacted, '(?m)^(EXPO_PUBLIC_E2E_HOST_EMAIL\s*=\s*").+?(@.+"\s*)$', '$1***$2')
    $redacted = [regex]::Replace($redacted, '(?m)^(EXPO_PUBLIC_E2E_VIEWER_EMAIL\s*=\s*").+?(@.+"\s*)$', '$1***$2')
    Set-Content -LiteralPath (Join-Path $RunDir ".env.local.e2e.used") -Value $redacted -Encoding UTF8
  } catch {
    # ignore
  }
  Info "Temporarily wrote E2E EXPO_PUBLIC_* vars to $($script:EnvLocalPath) (will restore in cleanup)"
}

function Pop-E2EEnvLocal() {
  try {
    if ($script:EnvLocalHadOriginal -and $script:EnvLocalBackupPath -and (Test-Path -LiteralPath $script:EnvLocalBackupPath)) {
      Copy-Item -LiteralPath $script:EnvLocalBackupPath -Destination $script:EnvLocalPath -Force
      Info "Restored original .env.local from backup."
      return
    }
    if (-not $script:EnvLocalHadOriginal -and (Test-Path -LiteralPath $script:EnvLocalPath)) {
      Remove-Item -LiteralPath $script:EnvLocalPath -Force -ErrorAction SilentlyContinue
      Info "Removed temporary .env.local."
    }
  } catch {
    # best-effort
  }
}

function Stop-ProcBestEffort($p) {
  try {
    if ($p -and -not $p.HasExited) {
      Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
    }
  } catch {
    # ignore
  }
}

function Try-LoadDotEnv([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return $false }
  try {
    $lines = Get-Content -LiteralPath $Path -ErrorAction Stop
    foreach ($line in $lines) {
      $t = ("$line").Trim()
      if ($t -eq "" -or $t.StartsWith("#")) { continue }
      $m = [regex]::Match($t, '^(?<k>[A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?<v>.*)$')
      if (-not $m.Success) { continue }
      $k = $m.Groups['k'].Value
      $v = $m.Groups['v'].Value.Trim()
      if (($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'"))) {
        if ($v.Length -ge 2) { $v = $v.Substring(1, $v.Length - 2) }
      }
      Set-Item -Path ("Env:" + $k) -Value $v
    }
    return $true
  } catch {
    return $false
  }
}

function Read-SecretPlain([string]$Prompt) {
  $sec = Read-Host -Prompt $Prompt -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

function Ensure-E2ECredentials([string]$Which) {
  # Credentials are only required if we need to drive the login UI.
  # Keep secrets out of disk: we may read .env.e2e.local if present, otherwise prompt interactively.
  $needHost = ($Which -eq 'host')
  $needViewer = ($Which -eq 'viewer')
  $needAll = ($Which -eq 'all')

  $missing = $false
  if ($needAll -or $needHost) {
    if (-not $env:EXPO_PUBLIC_E2E_HOST_EMAIL -or -not $env:EXPO_PUBLIC_E2E_HOST_PASSWORD) { $missing = $true }
  }
  if ($needAll -or $needViewer) {
    if (-not $env:EXPO_PUBLIC_E2E_VIEWER_EMAIL -or -not $env:EXPO_PUBLIC_E2E_VIEWER_PASSWORD) { $missing = $true }
  }
  if (-not $missing) { return }

  $dotEnv = Join-Path $Root ".env.e2e.local"
  $loaded = Try-LoadDotEnv $dotEnv
  if ($loaded) {
    Info "Loaded local env from $dotEnv"
  }

  # Prompt only for the credentials we still need.
  if ($needAll -or $needHost) {
    if (-not $env:EXPO_PUBLIC_E2E_HOST_EMAIL) { $env:EXPO_PUBLIC_E2E_HOST_EMAIL = Read-Host -Prompt "E2E host email" }
    if (-not $env:EXPO_PUBLIC_E2E_HOST_PASSWORD) { $env:EXPO_PUBLIC_E2E_HOST_PASSWORD = Read-SecretPlain "E2E host password" }
  }
  if ($needAll -or $needViewer) {
    if (-not $env:EXPO_PUBLIC_E2E_VIEWER_EMAIL) { $env:EXPO_PUBLIC_E2E_VIEWER_EMAIL = Read-Host -Prompt "E2E viewer email" }
    if (-not $env:EXPO_PUBLIC_E2E_VIEWER_PASSWORD) { $env:EXPO_PUBLIC_E2E_VIEWER_PASSWORD = Read-SecretPlain "E2E viewer password" }
  }

  if (($needAll -or $needHost) -and (-not $env:EXPO_PUBLIC_E2E_HOST_EMAIL -or -not $env:EXPO_PUBLIC_E2E_HOST_PASSWORD)) {
    Fail "Missing E2E host credentials. Provide them via env vars, .env.e2e.local, params, or interactive prompts."
  }
  if (($needAll -or $needViewer) -and (-not $env:EXPO_PUBLIC_E2E_VIEWER_EMAIL -or -not $env:EXPO_PUBLIC_E2E_VIEWER_PASSWORD)) {
    Fail "Missing E2E viewer credentials. Provide them via env vars, .env.e2e.local, params, or interactive prompts."
  }
}

# --- Tools ---
$adbCmd = (Get-Command adb -All -ErrorAction Stop | Where-Object { $_.CommandType -eq 'Application' } | Select-Object -First 1)
if (-not $adbCmd) { $adbCmd = (Get-Command adb -ErrorAction Stop | Select-Object -First 1) }
$adbExe = $adbCmd.Source
if (-not $adbExe) { Fail "Could not resolve adb executable path." }

# --- ADB sanity ---
Info "Ensuring adb server..."

function Invoke-AdbWithTimeout([string[]]$AdbArgs, [int]$TimeoutSec, [string]$Label) {
  $tmpOut = Join-Path $env:TEMP ("blyp_adb_{0}_{1}.out.txt" -f $Label, ([guid]::NewGuid().ToString('N')))
  $tmpErr = Join-Path $env:TEMP ("blyp_adb_{0}_{1}.err.txt" -f $Label, ([guid]::NewGuid().ToString('N')))
  try {
    $p = Start-Process -FilePath $adbExe -ArgumentList $AdbArgs -NoNewWindow -PassThru -RedirectStandardOutput $tmpOut -RedirectStandardError $tmpErr
    $done = $false
    try {
      $done = $p.WaitForExit($TimeoutSec * 1000)
    } catch {
      $done = $false
    }
    if (-not $done) {
      try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch {}
      $out = @(Get-Content -LiteralPath $tmpOut -ErrorAction SilentlyContinue)
      $err = @(Get-Content -LiteralPath $tmpErr -ErrorAction SilentlyContinue)
      Fail "ADB timed out running: adb $($AdbArgs -join ' ') (label=$Label). OUT=[$($out -join ' | ')] ERR=[$($err -join ' | ')]"
    }
    $out = @(Get-Content -LiteralPath $tmpOut -ErrorAction SilentlyContinue)
    $err = @(Get-Content -LiteralPath $tmpErr -ErrorAction SilentlyContinue)
    $exitCode = $null
    try { $exitCode = $p.ExitCode } catch {}
    if ($null -eq $exitCode) { $exitCode = 0 }
    if ($exitCode -ne 0) {
      Fail "ADB failed (exit=$exitCode) running: adb $($AdbArgs -join ' ') (label=$Label). OUT=[$($out -join ' | ')] ERR=[$($err -join ' | ')]"
    }
    return @{ out = $out; err = $err }
  } finally {
    try { Remove-Item -LiteralPath $tmpOut,$tmpErr -Force -ErrorAction SilentlyContinue } catch {}
  }
}

try {
  $null = Invoke-AdbWithTimeout -AdbArgs @("start-server") -TimeoutSec 15 -Label "start_server"
} catch {
  Warn "adb start-server failed; doing full adb reset and retrying once"
  try { Get-Process adb -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue } catch {}
  try { & $adbExe kill-server | Out-Null } catch {}
  Start-Sleep -Milliseconds 400
  $null = Invoke-AdbWithTimeout -AdbArgs @("start-server") -TimeoutSec 20 -Label "start_server_retry"
}

function Get-AdbDevicesWithRetry([int]$Attempts) {
  $out = $null
  for ($i = 0; $i -lt $Attempts; $i++) {
    $out = & $adbExe devices
    $hasAny = ($out | Select-String -Pattern "\t(device|unauthorized|offline)$" -ErrorAction SilentlyContinue | Measure-Object).Count
    if ($hasAny -gt 0) { return $out }
    Start-Sleep -Milliseconds 500
  }
  return $out
}

$devices = Get-AdbDevicesWithRetry 10
$deviceSerials = @($devices | Select-String -Pattern "\tdevice$" -ErrorAction SilentlyContinue | ForEach-Object { $_.Line.Split("`t")[0] })
if ($deviceSerials.Count -lt 2) {
  Info "Less than 2 devices after soft start; doing full adb reset..."
  Get-Process adb -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  & $adbExe kill-server | Out-Null
  & $adbExe start-server | Out-Null
  $devices = Get-AdbDevicesWithRetry 40
}

$rows = @(
  $devices |
    Select-String -Pattern "^\S+\s+\S+" |
    ForEach-Object {
      $parts = ($_.Line -split "\s+")
      if ($parts.Length -ge 2) {
        [PSCustomObject]@{ Serial = $parts[0]; State = $parts[1] }
      }
    }
)

$lines = @($rows | Where-Object { $_.State -eq "device" } | ForEach-Object { $_.Serial })

# Step-modes can be host-only; do not require or auto-select a viewer in that case.
$needTwoDevices = (-not $HostLoginOnly) -and (-not $HostGoLiveOnly)

if ($lines.Count -eq 0) {
  $unauth = @($rows | Where-Object { $_.State -eq "unauthorized" } | ForEach-Object { $_.Serial })
  $offline = @($rows | Where-Object { $_.State -eq "offline" } | ForEach-Object { $_.Serial })

  if ($unauth.Count -gt 0) {
    Fail "ADB device unauthorized ($($unauth -join ', ')). Unlock phone + accept RSA prompt, then rerun."
  }
  if ($offline.Count -gt 0) {
    Fail "ADB device offline ($($offline -join ', ')). Replug USB / toggle USB debugging, then rerun."
  }

  Fail "No ADB devices attached. Plug both phones in + accept RSA prompt. Then rerun."
}

if ($HostSerial -eq "") { $HostSerial = $lines[0] }

if ($needTwoDevices) {
  if ($ViewerSerial -eq "" -and $lines.Count -ge 2) { $ViewerSerial = $lines[1] }
  if ($lines.Count -lt 2 -or $ViewerSerial -eq "") {
    $devicesLong = (& $adbExe devices -l) -join "`n"
    Fail "Need 2 ADB devices (host + viewer). Current adb devices -l:`n$devicesLong"
  }
} else {
  # Force empty so all downstream checks skip viewer work.
  $ViewerSerial = ""
}

Info "HostSerial=$HostSerial"
Info "ViewerSerial=$ViewerSerial"

if ($RebuildInstall) {
  if ($needTwoDevices) {
    Info "Rebuild/install requested: building debug APK and installing to both devices..."
    & (Join-Path $Root "scripts\rebuild_install_dev_2phones.ps1") -HostSerial $HostSerial -ViewerSerial $ViewerSerial | Out-Host
  } else {
    Info "Rebuild/install requested: building debug APK and installing to HOST only..."
    & (Join-Path $Root "scripts\rebuild_install_dev_2phones.ps1") -HostSerial $HostSerial -ViewerSerial "" | Out-Host
  }
}

function Start-BackgroundCommand([string]$Name, [string]$Cmd, [string]$OutFile, [string]$ErrFile) {
  $ps = "${env:SystemRoot}\System32\WindowsPowerShell\v1.0\powershell.exe"
  $rootEsc = $Root -replace "'","''"
  $wrapped = "Set-Location -LiteralPath '$rootEsc'; `$ErrorActionPreference='Continue'; $Cmd"
  Info "Starting $Name in background (logs -> $OutFile)"
  return Start-Process -FilePath $ps -ArgumentList @("-NoProfile","-ExecutionPolicy","Bypass","-Command",$wrapped) -PassThru -NoNewWindow -RedirectStandardOutput $OutFile -RedirectStandardError $ErrFile
}

# --- Backend autodetect ---
$backendCmd = $null
if ($BackendMode -eq "none") {
  Info "BackendMode=none (skipping backend)."
} else {
  $svcLegacy = Join-Path $Root "blyp-live-service\package.json"
  $svcBackend = Join-Path $Root "backend\blyp-live-service\package.json"
  $fn  = Join-Path $Root "functions\package.json"

  $svcDir = $null
  if (Test-Path $svcBackend) { $svcDir = "backend\blyp-live-service" }
  elseif (Test-Path $svcLegacy) { $svcDir = "blyp-live-service" }

  if ($BackendMode -eq "service" -or ($BackendMode -eq "auto" -and $svcDir)) {
    if (-not $svcDir) {
      Fail "BackendMode=service requested but could not find service at backend\\blyp-live-service or blyp-live-service"
    }
    $backendCmd = "cd $svcDir; npm install; npm run dev"
    $backendHealth = "http://127.0.0.1:4000/health"
    Info "BackendMode=service"
  }
  elseif ($BackendMode -eq "functions" -or ($BackendMode -eq "auto" -and (Test-Path $fn))) {
    $backendCmd = "cd functions; npm install; npm run serve"
    $backendHealth = "http://127.0.0.1:5001"
    Info "BackendMode=functions"
  }
  else {
    Fail "Could not autodetect backend. Pass -BackendMode service|functions|none."
  }
}

# --- Metro command (canonical) ---
$metroCmd = "npm install; npm run dev-client -- --clear --port 8081"
$metroHealth = "http://127.0.0.1:8081/status"

function Get-HttpStatus([string]$Url) {
  try {
    return [int]((Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 2).StatusCode)
  } catch {
    $resp = $_.Exception.Response
    if ($resp -and $resp.StatusCode) {
      return [int]$resp.StatusCode
    }
    return $null
  }
}

function Test-HttpUp([string]$Url) {
  $code = Get-HttpStatus $Url
  return ($code -ne $null -and $code -ge 200 -and $code -lt 500)
}

function Ensure-HttpUp([string]$Url, [string]$Name) {
  if (Test-HttpUp $Url) {
    Ok "$Name already up ($Url)"
    return $true
  }
  return $false
}

function Assert-PortFreeOrFail([int]$Port, [string]$Name, [string]$HealthUrl = "") {
  $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listener) {
    $owningPid = [int]$listener.OwningProcess
    if ($ForceKillExisting) {
      Info "$Name port $Port already in use (PID=$owningPid). Killing existing process due to -ForceKillExisting..."
      Stop-Process -Id $owningPid -Force -ErrorAction SilentlyContinue
      Start-Sleep -Milliseconds 900
      $again = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($again) {
        Fail "$Name port $Port still in use after kill attempt (PID=$([int]$again.OwningProcess))."
      }
      return
    }
    Fail "$Name port $Port already in use (PID=$owningPid). Close existing process/window and rerun (or pass -ForceKillExisting)."
  }
}

function Get-AppPidOrFail([string]$Serial, [string]$Label) {
  function Start-App([string]$S) {
    # Prefer monkey for compatibility across devices/Android versions.
    # Some adb/monkey builds can emit stderr and trigger NativeCommandError under $ErrorActionPreference=Stop.
    # We treat launch as best-effort and validate via pidof afterwards.
    try {
      $null = Invoke-AdbCaptureWithTimeout @("-s",$S,"shell","monkey","-p","com.blyp.mobile","-c","android.intent.category.LAUNCHER","1") 4500
      return
    } catch {
      # Fallback: am start by package (may work when monkey fails)
      try {
        $null = Invoke-AdbCaptureWithTimeout @("-s",$S,"shell","am","start","-W","-a","android.intent.action.MAIN","-c","android.intent.category.LAUNCHER","-p","com.blyp.mobile") 6000
      } catch {
        # ignore
      }
    }
  }

  for ($i = 0; $i -lt 6; $i++) {
    $raw = (& $adbExe -s $Serial shell pidof com.blyp.mobile 2>$null)
    $raw = ("$raw").Trim()
    if ($raw -ne "") {
      return $raw.Split(' ')[0]
    }

    if ($i -eq 0) {
      Info "${Label}: com.blyp.mobile not running (pidof empty). Launching app..."
      Start-App $Serial
    }
    Start-Sleep -Seconds 2
  }

  Fail "${Label}: com.blyp.mobile not running (pidof empty) after auto-launch attempts. Unlock device and ensure the app can launch, then rerun."
}

function Start-LogcatPidCapture([string]$Serial, [string]$AppPid, [string]$OutFile, [string]$ErrFile) {
  $proc = Start-Process -FilePath $adbExe -ArgumentList @("-s",$Serial,"logcat","--pid=$AppPid","-v","time") -NoNewWindow -PassThru -RedirectStandardOutput $OutFile -RedirectStandardError $ErrFile
  Start-Sleep -Milliseconds 800
  if ($proc.HasExited) {
    $err = ""
    if (Test-Path $ErrFile) { $err = (Get-Content $ErrFile -Raw -ErrorAction SilentlyContinue) }
    if ($err -match "unknown option" -or $err -match "--pid") {
      # Fallback for devices/adb builds without --pid support.
      $ps = "${env:SystemRoot}\System32\WindowsPowerShell\v1.0\powershell.exe"
      $cmd = "& `"$adbExe`" -s `"$Serial`" logcat -v time | findstr /I `"com.blyp.mobile ReactNativeJS AndroidRuntime`""
      return Start-Process -FilePath $ps -ArgumentList @("-NoProfile","-ExecutionPolicy","Bypass","-Command",$cmd) -NoNewWindow -PassThru -RedirectStandardOutput $OutFile -RedirectStandardError $ErrFile
    }
  }
  return $proc
}

try {
  # --- Start background processes (no extra windows) ---
  $backendLogFile = Join-Path $runDir "backend.log"
  $backendErrFile = Join-Path $runDir "backend.err.log"
  $metroLogFile = Join-Path $runDir "metro.log"
  $metroErrFile = Join-Path $runDir "metro.err.log"

  $backendProc = $null
  $metroProc = $null
  $hostProc = $null
  $viewProc = $null
  $hostLogProc = $null
  $viewerLogProc = $null

  # Always verify server health first. If down, start them.
  # This prevents "stuck" runs caused by stale/cancelled previous attempts.
  $metroUp = Ensure-HttpUp $metroHealth "Metro"
  $backendUp = $true
  if ($backendCmd) {
    $backendUp = Ensure-HttpUp $backendHealth "Backend"
  }

  $needStart = (-not $metroUp) -or (-not $backendUp)
  if ($SkipServerStart -and -not $needStart) {
    Info "SkipServerStart set and servers are healthy; not restarting Metro/backend."
  } else {
    if ($SkipServerStart -and $needStart) {
      Info "SkipServerStart set but servers are not healthy; starting required servers anyway."
    }

    Push-E2EEnvLocal $runDir

    if (-not $metroUp) {
      Assert-PortFreeOrFail 8081 "Metro" $metroHealth
      $metroProc = Start-BackgroundCommand "Metro" $metroCmd $metroLogFile $metroErrFile
    }

    if ($backendCmd -and -not $backendUp) {
      if ($BackendMode -eq "service") { Assert-PortFreeOrFail 4000 "Backend(service)" $backendHealth }
      if ($BackendMode -eq "functions") { Assert-PortFreeOrFail 5001 "Backend(functions)" $backendHealth }
      $backendProc = Start-BackgroundCommand "Backend" $backendCmd $backendLogFile $backendErrFile
    }
  }

# --- Clear logcat early so parsing is deterministic ---
Info "Clearing device logcat buffers (host + viewer)..."
Clear-Logcat $HostSerial
if ($ViewerSerial -ne "") { Clear-Logcat $ViewerSerial }

# --- Port reverse for on-device localhost ---
Info "Setting adb reverse ports (Metro 8081 + backend)..."
Adb @("-s",$HostSerial,"reverse","tcp:8081","tcp:8081") | Out-Null
if ($ViewerSerial -ne "") { Adb @("-s",$ViewerSerial,"reverse","tcp:8081","tcp:8081") | Out-Null }

if ($BackendMode -eq "service" -or ($BackendMode -eq "auto" -and $backendCmd -and $backendHealth -match ":4000")) {
  Adb @("-s",$HostSerial,"reverse","tcp:4000","tcp:4000") | Out-Null
  if ($ViewerSerial -ne "") { Adb @("-s",$ViewerSerial,"reverse","tcp:4000","tcp:4000") | Out-Null }
}
elseif ($BackendMode -eq "functions" -or ($BackendMode -eq "auto" -and $backendCmd -and $backendHealth -match ":5001")) {
  Adb @("-s",$HostSerial,"reverse","tcp:5001","tcp:5001") | Out-Null
  if ($ViewerSerial -ne "") { Adb @("-s",$ViewerSerial,"reverse","tcp:5001","tcp:5001") | Out-Null }
}

# --- Logcat capture (host + viewer) ---
$hostLog = Join-Path $runDir "logcat_host.txt"
$viewLog = Join-Path $runDir "logcat_viewer.txt"
New-Item -ItemType File -Force -Path $hostLog,$viewLog | Out-Null

  Info "Starting logcat capture..."
  $hostProc = Start-Process -FilePath $adbExe -ArgumentList @("-s",$HostSerial,"logcat","-v","time") -PassThru -NoNewWindow -RedirectStandardOutput $hostLog
  $viewProc = $null
    if ($ViewerSerial -ne "") {
    $viewProc = Start-Process -FilePath $adbExe -ArgumentList @("-s",$ViewerSerial,"logcat","-v","time") -PassThru -NoNewWindow -RedirectStandardOutput $viewLog
  }

"HOST_LOGCAT_PID=$($hostProc.Id)" | Set-Content (Join-Path $runDir "pids.txt")
if ($viewProc) { "VIEWER_LOGCAT_PID=$($viewProc.Id)" | Add-Content (Join-Path $runDir "pids.txt") }

# --- Health checks ---
function Wait-Http([string]$Url, [int]$Seconds, [string]$Name) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    $code = Get-HttpStatus $Url
    if ($code -ne $null -and $code -ge 200 -and $code -lt 500) { Ok "$Name up ($Url)"; return }
    Start-Sleep -Milliseconds 500
  }
  Fail "$Name did not come up: $Url"
}

  Wait-Http $metroHealth 180 "Metro"
  if ($backendCmd) { Wait-Http $backendHealth 240 "Backend" }

  if ($StartServersOnly) {
    Ok "Servers are up. Leaving them running (StartServersOnly). RunDir=$runDir"
    return
  }

"HOST_SERIAL=$HostSerial" | Set-Content (Join-Path $runDir "pids.txt")
"VIEWER_SERIAL=$ViewerSerial" | Add-Content (Join-Path $runDir "pids.txt")

  Ok "Stack is up. RunDir=$runDir"

  Set-Step "dev_client_settle"

  # IMPORTANT: Do not auto-launch the app before the settle window.
  # Some earlier versions of this runner launched com.blyp.mobile to get a PID, which defeats the purpose of the delay.
  Info ("Waiting {0}s before opening Dev Client project (startup settle) at {1}..." -f $DevClientSettleSec, (Get-Date -Format "HH:mm:ss.fff"))
  Start-Sleep -Seconds $DevClientSettleSec

  # Make sure the device is awake/unlocked and the app is actually in foreground.
  # Without this, the exp+ deep link can be ignored and it looks like "the app never started".
  Wake-Unlock-BestEffort $HostSerial "HOST"
  if ($ViewerSerial -ne "") { Wake-Unlock-BestEffort $ViewerSerial "VIEWER" }

  Launch-AppBestEffort $HostSerial "HOST"
  if ($ViewerSerial -ne "") { Launch-AppBestEffort $ViewerSerial "VIEWER" }

  if (-not (Wait-ResumedActivityContains $HostSerial "com.blyp.mobile" 12 "HOST FOREGROUND")) {
    Info "HOST: com.blyp.mobile not observed as resumed activity (continuing anyway)"
  }
  if ($ViewerSerial -ne "") {
    if (-not (Wait-ResumedActivityContains $ViewerSerial "com.blyp.mobile" 12 "VIEWER FOREGROUND")) {
      Info "VIEWER: com.blyp.mobile not observed as resumed activity (continuing anyway)"
    }
  }

  # Ensure Expo Dev Client actually loads this Metro instance.
  # This forces the dev client to open the local project URL (works well with adb reverse).
  $devClientProject = "http://127.0.0.1:8081"
  $devClientProjectAlt = "http://localhost:8081"
  $runNonce = (Get-Date -Format "yyyyMMdd_HHmmss_fff")

  # Open dev client project ONLY (no deeplink yet). On cold/unstable starts Android may deliver deeplink before RN is ready.
  $openDevClientUrlHost = "exp+blyp-mobile://expo-development-client/?url=$(UrlEncode $devClientProject)"
  $openDevClientUrlViewer = "exp+blyp-mobile://expo-development-client/?url=$(UrlEncode $devClientProject)"
  $openDevClientUrlHostAlt = "exp+blyp-mobile://expo-development-client/?url=$(UrlEncode $devClientProjectAlt)"
  $openDevClientUrlViewerAlt = "exp+blyp-mobile://expo-development-client/?url=$(UrlEncode $devClientProjectAlt)"
  Info ("Opening Expo Dev Client project on devices: {0} at {1}" -f $devClientProject, (Get-Date -Format "HH:mm:ss.fff"))

  Set-Step "open_dev_client_project"
  $null = DeepLink $HostSerial $openDevClientUrlHost
  if ($ViewerSerial -ne "") { $null = DeepLink $ViewerSerial $openDevClientUrlViewer }

  # Verify that each device is actually ready (not stuck on the dev launcher screen).
  # Ready means: PRELUDE in logcat OR welcome/auth UI visible.
  # If not, retry using localhost, which can be more reliable with adb reverse.
  $hostReady = Wait-AppReadyForE2E $HostSerial 45 'HOST READY' $hostLog
  if (-not $hostReady) {
    Info 'HOST: not ready yet; retrying dev-client open using localhost'
    Dump-DeviceState $HostSerial "HOST" $runDir
    Capture-Screenshot $HostSerial (Join-Path $runDir "host_not_ready_before_retry.png")
    $null = DeepLink $HostSerial $openDevClientUrlHostAlt
    $hostReady = Wait-AppReadyForE2E $HostSerial 60 'HOST READY (retry)' $hostLog
    if (-not $hostReady) { Fail "HOST did not become ready (no PRELUDE and no welcome/auth UI)." }
  }

  # IMPORTANT (speed): do not block HOST go-live on VIEWER readiness.
  # Viewer prep is deferred until the join step.

  # --- UI-only login (single path; no deeplink login; no repeated retries) ---
  # IMPORTANT: do not keep re-typing credentials if we're already logged in.
  Set-Step "host_login"
  if (-not (Test-LoggedInUi $HostSerial)) {
    Ensure-E2ECredentials 'host'
    $null = Wait-WelcomeScreenUi $HostSerial 25 "HOST UI READY (for login)"
    $okHostUi = Try-UiLogin $HostSerial $env:EXPO_PUBLIC_E2E_HOST_EMAIL $env:EXPO_PUBLIC_E2E_HOST_PASSWORD "HOST"
    if (-not $okHostUi) { Fail "HOST UI login failed to drive the UI." }
    if (-not (Wait-AuthSuccessOrLoggedInUi $HostSerial 30 "HOST LOGIN (ui)" $hostLog)) { Fail "HOST UI login did not confirm via logcat or UI." }
  } else {
    Ok "HOST: logged-in UI already detected; skipping login"
  }

  Capture-Screenshot $HostSerial (Join-Path $runDir "host_after_login.png")

  if ($HostLoginOnly) {
    Ok "HOST login completed (HostLoginOnly). Stopping here. RunDir=$runDir"
    return
  }

  if ($HostGoLiveOnly) {
    Set-Step "host_go_live"
    $e2eTitle = "E2E $ts"
    Info "HOST go-live (HostGoLiveOnly) title='$e2eTitle'"
    Wake-Unlock-BestEffort $HostSerial "HOST"
    Launch-AppBestEffort $HostSerial "HOST"
    $hostGoLiveOk = Try-HostGoLiveViaUi $HostSerial $e2eTitle $runDir
    if (-not $hostGoLiveOk) {
      Fail "HOST: failed to start go-live via UI (HostGoLiveOnly)."
    }
    try { Handle-RuntimePermissionDialogsBestEffort $HostSerial "HOST" 12 } catch {}
    $t0 = (Get-Date).ToString('HHmmss')
    Capture-Screenshot $HostSerial (Join-Path $runDir "host_after_go_live_trigger_${t0}.png")
    Ok "HOST go-live triggered (HostGoLiveOnly). Stopping here. RunDir=$runDir"
    return
  }

  if ($LoginBothOnly) {
    Set-Step "viewer_ready_for_login"
    $viewerReady = Wait-AppReadyForE2E $ViewerSerial 45 'VIEWER READY (login only)' $viewLog
    if (-not $viewerReady) {
      Info 'VIEWER: not ready yet; retrying dev-client open using localhost'
      Dump-DeviceState $ViewerSerial "VIEWER" $runDir
      Capture-Screenshot $ViewerSerial (Join-Path $runDir "viewer_not_ready_before_retry.png")
      $null = DeepLink $ViewerSerial $openDevClientUrlViewerAlt
      $viewerReady = Wait-AppReadyForE2E $ViewerSerial 60 'VIEWER READY (retry, login only)' $viewLog
      if (-not $viewerReady) { Fail "VIEWER did not become ready (no PRELUDE and no welcome/auth UI)." }
    }

    Set-Step "viewer_login"
    if (-not (Test-LoggedInUi $ViewerSerial)) {
      Ensure-E2ECredentials 'viewer'
      $null = Wait-WelcomeScreenUi $ViewerSerial 25 "VIEWER UI READY (for login)"
      $okViewerUi = Try-UiLogin $ViewerSerial $env:EXPO_PUBLIC_E2E_VIEWER_EMAIL $env:EXPO_PUBLIC_E2E_VIEWER_PASSWORD "VIEWER"
      if (-not $okViewerUi) { Fail "VIEWER UI login failed to drive the UI." }
      if (-not (Wait-AuthSuccessOrLoggedInUi $ViewerSerial 30 "VIEWER LOGIN (ui)" $viewLog)) { Fail "VIEWER UI login did not confirm via logcat or UI." }
    } else {
      Ok "VIEWER: logged-in UI already detected; skipping login"
    }

    Capture-Screenshot $ViewerSerial (Join-Path $runDir "viewer_after_login.png")
    Ok "HOST+VIEWER login completed (LoginBothOnly). Stopping here. RunDir=$runDir"
    return
  }

  if ($LoginBothThenHostGoLiveOnly) {
    Set-Step "viewer_ready_for_login"
    $viewerReady = Wait-AppReadyForE2E $ViewerSerial 45 'VIEWER READY (step3)' $viewLog
    if (-not $viewerReady) {
      Info 'VIEWER: not ready yet; retrying dev-client open using localhost'
      Dump-DeviceState $ViewerSerial "VIEWER" $runDir
      Capture-Screenshot $ViewerSerial (Join-Path $runDir "viewer_not_ready_before_retry.png")
      $null = DeepLink $ViewerSerial $openDevClientUrlViewerAlt
      $viewerReady = Wait-AppReadyForE2E $ViewerSerial 60 'VIEWER READY (retry, step3)' $viewLog
      if (-not $viewerReady) { Fail "VIEWER did not become ready (no PRELUDE and no welcome/auth UI)." }
    }

    Set-Step "viewer_login"
    if (-not (Test-LoggedInUi $ViewerSerial)) {
      Ensure-E2ECredentials 'viewer'
      $null = Wait-WelcomeScreenUi $ViewerSerial 25 "VIEWER UI READY (for login)"
      $okViewerUi = Try-UiLogin $ViewerSerial $env:EXPO_PUBLIC_E2E_VIEWER_EMAIL $env:EXPO_PUBLIC_E2E_VIEWER_PASSWORD "VIEWER"
      if (-not $okViewerUi) { Fail "VIEWER UI login failed to drive the UI." }
      if (-not (Wait-AuthSuccessOrLoggedInUi $ViewerSerial 30 "VIEWER LOGIN (ui)" $viewLog)) { Fail "VIEWER UI login did not confirm via logcat or UI." }
    } else {
      Ok "VIEWER: logged-in UI already detected; skipping login"
    }
    Capture-Screenshot $ViewerSerial (Join-Path $runDir "viewer_after_login.png")

    Set-Step "host_go_live"
    $e2eTitle = "E2E $ts"
    Info "HOST go-live (step3) title='$e2eTitle'"
    Wake-Unlock-BestEffort $HostSerial "HOST"
    Launch-AppBestEffort $HostSerial "HOST"
    $hostGoLiveOk = Try-HostGoLiveViaUi $HostSerial $e2eTitle $runDir
    if (-not $hostGoLiveOk) {
      Fail "HOST: failed to start go-live via UI (step3)."
    }
    try { Handle-RuntimePermissionDialogsBestEffort $HostSerial "HOST" 12 } catch {}
    $t0 = (Get-Date).ToString('HHmmss')
    Capture-Screenshot $HostSerial (Join-Path $runDir "host_after_go_live_trigger_${t0}.png")
    Ok "HOST+VIEWER login completed; HOST go-live triggered (step3). Stopping here. RunDir=$runDir"
    return
  }

  Info "Checkpoint: HOST login complete; resolving HOST PID (viewer deferred)"

  # Now that we've opened the Dev Client project, capture PID-filtered logs for higher signal.
  $hostAppPid = Get-AppPidOrFail $HostSerial "HOST"
  Info "Checkpoint: resolved HOST PID (HOST=$hostAppPid)"
  "HOST_APP_PID=$hostAppPid" | Add-Content (Join-Path $runDir "pids.txt")

  # --- PID-filtered Logcat capture (host + viewer) ---
  $hostPidLog = Join-Path $runDir "logcat_host_pid.txt"
  $viewerPidLog = Join-Path $runDir "logcat_viewer_pid.txt"
  $hostPidErr = Join-Path $runDir "logcat_host_pid.err.txt"
  $viewerPidErr = Join-Path $runDir "logcat_viewer_pid.err.txt"

  Remove-Item $hostPidLog,$viewerPidLog,$hostPidErr,$viewerPidErr -Force -ErrorAction SilentlyContinue
  New-Item -ItemType File -Force -Path $hostPidLog,$viewerPidLog,$hostPidErr,$viewerPidErr | Out-Null

  Info "Starting HOST PID-filtered logcat capture (viewer deferred)..."
  $hostLogProc = Start-LogcatPidCapture $HostSerial $hostAppPid $hostPidLog $hostPidErr
  $viewerLogProc = $null

  Info "Checkpoint: PID logcat capture started"

  "HOST_LOGCAT_PROC_PID=$($hostLogProc.Id)" | Add-Content (Join-Path $runDir "pids.txt")
  "HOST_LOGCAT_FILE=logcat_host_pid.txt" | Add-Content (Join-Path $runDir "pids.txt")
  "VIEWER_LOGCAT_FILE=logcat_viewer_pid.txt" | Add-Content (Join-Path $runDir "pids.txt")

  # Sanity: ensure the app is actually loading JS from Metro.
  # We already gated on the JS PRELUDE, so do not stall here for minutes.
  # Keep this as a short, best-effort check for diagnostics only.
  $bundleWaitSec = 30
  try {
    if (Test-Path -LiteralPath $metroLogFile) {
      $null = Try-WaitFilePattern $metroLogFile "\b(Android|iOS)\s+Bundled\b|\bBundled\s+\d+ms\b" $bundleWaitSec
    } else {
      $null = Wait-LogcatPattern $HostSerial 'ReactNativeJS.*(Running|loaded)|Running "main"|JS bundle' $bundleWaitSec "HOST JS LOADED"
      if ($ViewerSerial -ne "") {
        $null = Wait-LogcatPattern $ViewerSerial 'ReactNativeJS.*(Running|loaded)|Running "main"|JS bundle' $bundleWaitSec "VIEWER JS LOADED"
      }
    }
  } catch {
    Warn "Bundle readiness signal not observed quickly; continuing"
  }

  function Ensure-ViewerPrepared() {
    if (-not $ViewerSerial -or $ViewerSerial -eq "") { return }

    # Ensure dev client project is loaded on viewer (best-effort, but bounded).
    $viewerReady = Wait-AppReadyForE2E $ViewerSerial 25 'VIEWER READY (deferred)' $viewLog
    if (-not $viewerReady) {
      Info 'VIEWER: not ready yet (deferred); retrying dev-client open using localhost'
      Dump-DeviceState $ViewerSerial "VIEWER" $runDir
      Capture-Screenshot $ViewerSerial (Join-Path $runDir "viewer_not_ready_before_retry.png")
      $null = DeepLink $ViewerSerial $openDevClientUrlViewerAlt
      $viewerReady = Wait-AppReadyForE2E $ViewerSerial 45 'VIEWER READY (retry, deferred)' $viewLog
      if (-not $viewerReady) { Fail "VIEWER did not become ready (no PRELUDE and no welcome/auth UI)." }
    }

    # Login viewer only if needed.
    if (-not (Test-LoggedInUi $ViewerSerial)) {
      Ensure-E2ECredentials 'viewer'
      $null = Wait-WelcomeScreenUi $ViewerSerial 25 "VIEWER UI READY (for login)"
      $okViewerUi = Try-UiLogin $ViewerSerial $env:EXPO_PUBLIC_E2E_VIEWER_EMAIL $env:EXPO_PUBLIC_E2E_VIEWER_PASSWORD "VIEWER"
      if (-not $okViewerUi) { Fail "VIEWER UI login failed to drive the UI." }
      if (-not (Wait-AuthSuccessOrLoggedInUi $ViewerSerial 30 "VIEWER LOGIN (ui)" $viewLog)) { Fail "VIEWER UI login did not confirm via logcat or UI." }
    } else {
      Ok "VIEWER: logged-in UI already detected; skipping login"
    }

    # Start viewer PID log capture if it isn't already running.
    if (-not $viewerLogProc) {
      Capture-Screenshot $ViewerSerial (Join-Path $runDir "viewer_after_login.png")
      $viewerAppPidLocal = Get-AppPidOrFail $ViewerSerial "VIEWER"
      Set-Variable -Name viewerAppPid -Value $viewerAppPidLocal -Scope 1
      "VIEWER_APP_PID=$viewerAppPidLocal" | Add-Content (Join-Path $runDir "pids.txt")
      Info "Starting VIEWER PID-filtered logcat capture (deferred)..."
      $viewerLogProcLocal = Start-LogcatPidCapture $ViewerSerial $viewerAppPidLocal $viewerPidLog $viewerPidErr
      Set-Variable -Name viewerLogProc -Value $viewerLogProcLocal -Scope 1
      "VIEWER_LOGCAT_PROC_PID=$($viewerLogProcLocal.Id)" | Add-Content (Join-Path $runDir "pids.txt")
    }
  }


  # IMPORTANT: Full E2E sequencing must not skip viewer login.
  # Prepare/login the viewer BEFORE triggering host go-live so we don't appear to jump from host_login -> host_go_live.
  if ($ViewerSerial -ne "") {
    Set-Step "viewer_ready_for_login"
    Ensure-ViewerPrepared
  }


# --- E2E: Host go live (UI: enter title + tap Go Live) ---
$e2eTitle = "E2E $ts"
  Set-Step "host_go_live"
  Info "E2E host go-live (UI) title='$e2eTitle'"
  Wake-Unlock-BestEffort $HostSerial "HOST"
  Launch-AppBestEffort $HostSerial "HOST"
  $hostGoLiveOk = Try-HostGoLiveViaUi $HostSerial $e2eTitle $runDir
  if (-not $hostGoLiveOk) {
    Fail "HOST: failed to start go-live via UI (title + Go Live)."
  }

  # Intentionally do not attempt to dismiss the dev menu.

  # Keep the flow minimal here: viewer join step will handle navigation if needed.

  # Capture early state for both devices right after go-live is triggered.
  $t0 = (Get-Date).ToString('HHmmss')
  Capture-Screenshot $HostSerial (Join-Path $runDir "host_after_go_live_trigger_${t0}.png")
  Capture-Screenshot $ViewerSerial (Join-Path $runDir "viewer_after_go_live_trigger_${t0}.png")

  # Host view can trigger camera/mic permission prompts; accept them if they appear.
  Handle-RuntimePermissionDialogsBestEffort $HostSerial "HOST" 15

  # Non-blocking auth confirmation after go-live sequencing begins.
  # Keep this very short; being logged in is already confirmed by UI earlier.
  $authWaitSec = 3
  $authPattern = "\[AUTH\]\[SUCCESS\] password_login"
  $hostAuthOk = $false
  $viewerAuthOk = $false
  if (Test-Path -LiteralPath $metroLogFile) {
    $hostAuthOk = Try-WaitFilePattern $metroLogFile $authPattern $authWaitSec
    $viewerAuthOk = $hostAuthOk
  } else {
    if (Test-Path -LiteralPath $hostPidLog) { $hostAuthOk = Try-WaitFilePattern $hostPidLog $authPattern $authWaitSec }
    # Viewer PID logging is deferred; don't treat missing viewer auth marker as a warning.
    if ($ViewerSerial -ne "" -and $viewerLogProc -and (Test-Path -LiteralPath $viewerPidLog)) { $viewerAuthOk = Try-WaitFilePattern $viewerPidLog $authPattern $authWaitSec } else { $viewerAuthOk = $true }
  }
  if (-not $hostAuthOk -or -not $viewerAuthOk) {
    Warn "Auth success marker not observed quickly (host=$hostAuthOk viewer=$viewerAuthOk). Continuing."
  }

  # Step 4 should start immediately. Do NOT stall here on Firestore registration.
  # Best-effort parse of hostUid/streamId for a fast viewer deeplink path; fall back to UI join if missing.
  Set-Step "host_registering_firestore"
  $hostUid = $null
  $streamId = $null
  try {
    $dumpHost = @()
    if (Test-Path -LiteralPath $hostPidLog) {
      $dumpHost = Get-RecentLinesFromFile $hostPidLog 8000
    } else {
      $dumpHost = Get-LogcatDump $HostSerial
    }

    $regBlock = ""
    $idx = Get-LastMatchingIndex $dumpHost "\[LIVE\]\[IVS\]\[REGISTERING_FIRESTORE\]"
    if ($idx -ge 0) {
      $end = [Math]::Min($dumpHost.Count - 1, $idx + 20)
      $regBlock = ($dumpHost[$idx..$end] -join "\n")
    }

    $sidMatch = ($dumpHost | Select-String -Pattern "\[LIVE\]\[IVS\]\[FIRESTORE_REGISTERED\]" -ErrorAction SilentlyContinue | Select-Object -Last 1)
    $sidLine = $null
    if ($sidMatch) {
      if ($sidMatch -is [Microsoft.PowerShell.Commands.MatchInfo]) { $sidLine = $sidMatch.Line }
      elseif ($sidMatch -is [string]) { $sidLine = $sidMatch }
      else { try { $sidLine = $sidMatch.Line } catch { $sidLine = [string]$sidMatch } }
    }

    if ($regBlock -match '"uid"\s*:\s*"([^"]+)"') { $hostUid = $matches[1] }
    elseif ($regBlock -match "\buid\s*[:=]\s*'([^']+)'" ) { $hostUid = $matches[1] }
    elseif ($regBlock -match '\buid\s*[:=]\s*([^,}\s\n]+)') { $hostUid = $matches[1].Trim('"').Trim("'") }

    if ($sidLine -match '"streamId"\s*:\s*"([^"]+)"') { $streamId = $matches[1] }
    elseif ($sidLine -match "\bstreamId\s*[:=]\s*'([^']+)'" ) { $streamId = $matches[1] }
    elseif ($regBlock -match '"streamId"\s*:\s*"([^"]+)"') { $streamId = $matches[1] }
    elseif ($regBlock -match "\bstreamId\s*[:=]\s*'([^']+)'" ) { $streamId = $matches[1] }
    elseif ($regBlock -match '\bstreamId\s*[:=]\s*([^,}\s\n]+)') { $streamId = $matches[1].Trim('"').Trim("'") }

    # Fallback 1: derive streamId from IVS local preview key (key=local:<sessionId>), which is always
    # present when the host creates local streams. In IVS mode, the app uses the sessionId as streamId.
    if (-not $streamId) {
      $localKeyMatch = ($dumpHost | Select-String -Pattern "key=local:([0-9a-fA-F-]{8,})" -ErrorAction SilentlyContinue | Select-Object -Last 1)
      if ($localKeyMatch) {
        $localLine = $null
        try { $localLine = $localKeyMatch.Line } catch { $localLine = [string]$localKeyMatch }
        if ($localLine -match "key=local:([0-9a-fA-F-]{8,})") {
          $streamId = $matches[1]
        }
      }
    }

    # Fallback 2: derive hostUid from recent auth debug logs.
    if (-not $hostUid) {
      $authBlock = ""
      $authIdx = Get-LastMatchingIndex $dumpHost "\[AUTH DEBUG\]"
      if ($authIdx -ge 0) {
        $end = [Math]::Min($dumpHost.Count - 1, $authIdx + 20)
        $authBlock = ($dumpHost[$authIdx..$end] -join "\n")
      }
      if ($authBlock -match "uid\s*:\s*'([^']+)'" ) { $hostUid = $matches[1] }
      elseif ($authBlock -match 'uid\s*:\s*"([^"]+)"' ) { $hostUid = $matches[1] }
    }
  } catch {}

  if ($hostUid -and $streamId) {
    Info "Parsed hostUid=$hostUid"
    Info "Parsed streamId=$streamId"
  } else {
    Warn "Could not parse hostUid/streamId quickly. Continuing with viewer UI join."
  }

  Capture-Screenshot $HostSerial (Join-Path $runDir "host_after_go_live.png")

  # Quick (non-blocking) local video sanity check; don't stall Step 4.
  $localVideoPattern = "\\[IVS_NATIVE\\]\\[LOCAL_VIDEO_ADDED\\]|LOCAL_VIDEO_ADDED|LOCAL_VIDEO"
  $localVideoOk = $false
  if (Test-Path -LiteralPath $hostPidLog) {
    $localVideoOk = Try-WaitFilePattern $hostPidLog $localVideoPattern 8
  }
  if (-not $localVideoOk) {
    Warn "HOST did not report local video start quickly (pattern '$localVideoPattern'). Continuing to viewer join."
  }

  # --- E2E: Viewer join ---
  Set-Step "viewer_join"
  Info "E2E viewer join"

  # Ensure viewer PID capture + login are ready before we start checking PID logs.
  if ($ViewerSerial -ne "") {
    Ensure-ViewerPrepared
  }

  # Keep going until the viewer actually reports remote video OR we hit a deadline.
  $viewerVideoOk = $false
  # Keep retrying, but bound it. 4 minutes is plenty and avoids endless waits.
  if ($ViewerJoinDeadlineSec -lt 60) { $ViewerJoinDeadlineSec = 60 }
  $viewerDeadline = (Get-Date).AddSeconds($ViewerJoinDeadlineSec)

  # Success signals. IMPORTANT: prefer PID log file checks (cheap + complete) over adb logcat dumps (slow + truncated).
  $stageJoinPattern = "\\[IVS_VIEWER\\]\\[STAGE_JOIN_SUCCESS\\]"
  $remoteVideoPattern = "\\[IVS_VIEWER\\]\\[REMOTE_VIDEO_ADDED\\]|\\[IVS_BRIDGE\\]\\[REMOTE_VIDEO_ADDED\\]|IVS_REMOTE_VIDEO_ADDED|IVS_REMOTE_FIRST_FRAME_SIGNAL|remoteTracks:\\s*[1-9]"

  $attempt = 0

  while ((Get-Date) -lt $viewerDeadline -and -not $viewerVideoOk) {
    $attempt++
    # Ensure the viewer is in foreground.
    Wake-Unlock-BestEffort $ViewerSerial "VIEWER"
    Launch-AppBestEffort $ViewerSerial "VIEWER"
    try { Handle-RuntimePermissionDialogsBestEffort $ViewerSerial "VIEWER" 3 } catch {}

    # If we have IDs, try the deeplink path (fast). Otherwise, go straight to UI join.
    if ($hostUid -and $streamId) {
      $viewerPayload = "streamId=$streamId&hostUid=$hostUid"
      $viewerUrl = "blyp://e2e-live-viewer?payload=$(UrlEncode $viewerPayload)"
      $null = DeepLink $ViewerSerial $viewerUrl
    }

    # If we already have remote video in the PID log, stop immediately.
    if (Test-FilePatternAny $viewerPidLog $remoteVideoPattern) {
      Ok "VIEWER VIDEO: success signal already present in PID log"
      $viewerVideoOk = $true
      break
    }

    # UI join is expensive; throttle it.
    if ($attempt -eq 1 -or ($ViewerJoinUiEvery -gt 0 -and ($attempt % $ViewerJoinUiEvery -eq 0))) {
      $null = Try-ViewerJoinViaUi $ViewerSerial $e2eTitle $runDir
    }

    # Now look for join + viewer screen + remote video; use short waits so we can retry.
    $joined = $false
    if (Test-FilePatternAny $viewerPidLog $stageJoinPattern) {
      $joined = $true
    } else {
      $joined = Try-WaitFilePattern $viewerPidLog $stageJoinPattern 15
    }

    if ($joined) {
      try {
        $null = Wait-ViewerLiveScreen $ViewerSerial 20 "VIEWER LIVE SCREEN"
      } catch {
        # Force UI path again if join succeeded but UI didn't navigate.
        $null = Try-ViewerJoinViaUi $ViewerSerial $e2eTitle $runDir
      }

      # First check the PID log file for any earlier success (robust against logcat tail truncation).
      if (Test-FilePatternAny $viewerPidLog $remoteVideoPattern) {
        Ok "VIEWER VIDEO: success signal already present in PID log"
        $viewerVideoOk = $true
        break
      }

      # Then do a short wait for new signals to arrive.
      if (Try-WaitFilePattern $viewerPidLog $remoteVideoPattern 45) {
        Ok "VIEWER VIDEO: success signal observed in PID log"
        $viewerVideoOk = $true
        break
      }

      # Fallback: attempt to detect via adb logcat dump.
      try {
        $null = Wait-LogcatPattern $ViewerSerial $remoteVideoPattern 25 "VIEWER VIDEO (logcat)"
        $viewerVideoOk = $true
        break
      } catch {
        $viewerVideoOk = $false
      }
    }

    Start-Sleep -Milliseconds 900
  }

  if (-not $viewerVideoOk) {
    $t = (Get-Date).ToString('HHmmss')
    Capture-Screenshot $ViewerSerial (Join-Path $runDir "viewer_no_remote_video_${t}.png")
    $null = Save-UiDump $ViewerSerial (Join-Path $runDir "viewer_no_remote_video_${t}.xml")
    Dump-DeviceState $ViewerSerial "viewer_no_remote_video_${t}" $runDir
    Fail "VIEWER did not reach REMOTE_VIDEO_ADDED within the retry window."
  }

  Capture-Screenshot $ViewerSerial (Join-Path $runDir "viewer_after_join.png")

  Info "Capturing for $DurationSec seconds..."
  Start-Sleep -Seconds $DurationSec

  Stop-ProcBestEffort $hostLogProc
  Stop-ProcBestEffort $viewerLogProc

  $hostSize = (Get-Item $hostPidLog).Length
  $viewerSize = (Get-Item $viewerPidLog).Length
  if ($hostSize -le 0) { Fail "Host PID log is empty ($hostPidLog)." }
  if ($viewerSize -le 0) { Fail "Viewer PID log is empty ($viewerPidLog). Viewer capture must never be 0 bytes." }

# --- Signal extraction (PID logs) ---
$patterns = @(
  "AndroidRuntime","FATAL EXCEPTION","ReactNativeJS","Invariant Violation",
  "tried to register two views","same name","IVSBroadcastView","IVSPlayerView","IVSRealTimeView",
  "Element type is invalid","lazy element type","requireNativeComponent",
  "\[LIVE\]","Go Live","GO_LIVE","startLive","startHostLive","ivsLiveApi","/api/live","/health",
  "Network request failed","ECONNREFUSED","timeout","401","403","404",
  "stageArn","Participant","token","Broadcast","Camera","Permission"
)

$signalsFile = Join-Path $runDir "signals_pid.txt"
"===== FILE LIST =====" | Tee-Object $signalsFile
Get-ChildItem $runDir -Force | Select-Object Name,Length,LastWriteTime | Out-String | Add-Content $signalsFile

"===== METRO TAIL =====" | Add-Content $signalsFile
if (Test-Path $metroLogFile) { Get-Content $metroLogFile -Tail 250 | Add-Content $signalsFile }

"===== BACKEND TAIL =====" | Add-Content $signalsFile
if (Test-Path $backendLogFile) { Get-Content $backendLogFile -Tail 250 | Add-Content $signalsFile }

"===== HOST PID LOGCAT SIGNALS (with context) =====" | Add-Content $signalsFile
Select-String -Path $hostPidLog -Pattern $patterns -CaseSensitive:$false -Context 3,8 |
  ForEach-Object { $_.ToString() } | Select-Object -First 600 |
  Add-Content $signalsFile

"===== VIEWER PID LOGCAT SIGNALS (with context) =====" | Add-Content $signalsFile
Select-String -Path $viewerPidLog -Pattern $patterns -CaseSensitive:$false -Context 3,8 |
  ForEach-Object { $_.ToString() } | Select-Object -First 600 |
  Add-Content $signalsFile

  Ok "DONE -> $signalsFile"
  Write-Host "===== HOST PID LOG (tail 120) ====="
  Get-Content $hostPidLog -Tail 120
  Write-Host "===== VIEWER PID LOG (tail 120) ====="
  Get-Content $viewerPidLog -Tail 120
  Write-Host "===== SIGNALS (tail 220) ====="
  Get-Content $signalsFile -Tail 220
}
catch {
  $script:ExitCode = 1
  $m = $_.Exception.Message
  if (-not $m) { $m = ("$_." ) }
  Write-Host "FAIL: $m" -ForegroundColor Red

  # Best-effort: emit a minimal signals file even on failure to speed up diagnosis.
  try {
    $signalsFile = Join-Path $runDir "signals_pid.txt"
    "===== FAILURE =====" | Set-Content -Path $signalsFile -Encoding utf8
    $m | Add-Content -Path $signalsFile
    "" | Add-Content -Path $signalsFile
    "===== FILE LIST =====" | Add-Content -Path $signalsFile
    Get-ChildItem $runDir -Force | Select-Object Name,Length,LastWriteTime | Out-String | Add-Content $signalsFile
    "===== METRO ERR TAIL =====" | Add-Content -Path $signalsFile
    if (Test-Path $metroErrFile) { Get-Content $metroErrFile -Tail 180 | Add-Content $signalsFile }
    "===== BACKEND ERR TAIL =====" | Add-Content -Path $signalsFile
    if (Test-Path $backendErrFile) { Get-Content $backendErrFile -Tail 180 | Add-Content $signalsFile }
    "===== HOST PID LOG TAIL =====" | Add-Content -Path $signalsFile
    if (Test-Path $hostPidLog) { Get-Content $hostPidLog -Tail 220 | Add-Content $signalsFile }
    "===== VIEWER PID LOG TAIL =====" | Add-Content -Path $signalsFile
    if (Test-Path $viewerPidLog) { Get-Content $viewerPidLog -Tail 220 | Add-Content $signalsFile }
  } catch {
    # ignore
  }
}
finally {
  Stop-ProcBestEffort $hostLogProc
  Stop-ProcBestEffort $viewerLogProc
  Stop-ProcBestEffort $hostProc
  Stop-ProcBestEffort $viewProc
  if (-not $KeepServers) {
    Stop-ProcBestEffort $metroProc
    Stop-ProcBestEffort $backendProc
  } else {
    Info "KeepServers set: leaving Metro/backend running."
  }
  if ($KeepServers) {
    Info "KeepServers set: leaving temporary .env.local in place so Metro keeps E2E vars."
    Info "When done, stop Metro and restore by running without -KeepServers (or manually revert .env.local)."
  } else {
    Pop-E2EEnvLocal
  }
}

exit $script:ExitCode