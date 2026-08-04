# Deep smoke for modern teal batch APK on a connected Fold (adb).
# Usage: powershell -File tools/agent/SMOKE_MODERN_BATCH_FOLD.ps1 [-Serial RFGL10S65TX]
param(
  [string]$Serial = '',
  [string]$Package = 'com.blyp.mobile',
  [int]$MinVersionCode = 2026304685
)

$ErrorActionPreference = 'Stop'
function Invoke-Adb {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$AdbArgs)
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    if ($Serial) { & adb -s $Serial @AdbArgs 2>&1 | Where-Object { $_ -is [string] -or $_.ToString() } | ForEach-Object { "$_" } }
    else { & adb @AdbArgs 2>&1 | Where-Object { $_ -is [string] -or $_.ToString() } | ForEach-Object { "$_" } }
  } finally {
    $ErrorActionPreference = $prev
  }
}
function Dump-Ui {
  Invoke-Adb shell uiautomator dump /sdcard/ui.xml | Out-Null
  $local = Join-Path $env:TEMP 'blyp-smoke-ui.xml'
  Invoke-Adb pull /sdcard/ui.xml $local 2>$null | Out-Null
  return $local
}
function Get-Texts([string]$Path) {
  [xml]$x = Get-Content $Path
  $x.SelectNodes("//node[@text!='']") | ForEach-Object { $_.GetAttribute('text') } | Where-Object { $_ -and $_.Length -lt 160 }
}
function Tap-Text([string]$Path, [string]$Label) {
  [xml]$x = Get-Content $Path
  foreach ($node in $x.SelectNodes('//node')) {
    if ($node.GetAttribute('package') -ne $Package) { continue }
    if ($node.GetAttribute('text') -eq $Label -or $node.GetAttribute('content-desc') -eq $Label) {
      $b = $node.GetAttribute('bounds')
      if ($b -match '\[(\d+),(\d+)\]\[(\d+),(\d+)\]') {
        $cx = [int](([int]$Matches[1] + [int]$Matches[3]) / 2)
        $cy = [int](([int]$Matches[2] + [int]$Matches[4]) / 2)
        Invoke-Adb shell input tap $cx $cy
        Write-Host "Tapped $Label"
        return $true
      }
    }
  }
  Write-Host "NOT FOUND: $Label"
  return $false
}

$devices = & adb devices | Select-Object -Skip 1 | Where-Object { $_ -match '\tdevice$' }
if (-not $devices) { throw 'No authorized adb device. Unlock phone and allow USB debugging.' }
if (-not $Serial) {
  $Serial = ($devices[0] -split '\s+')[0]
}
Write-Host "Using serial=$Serial"

$vc = (Invoke-Adb shell dumpsys package $Package | Select-String 'versionCode=' | Select-Object -First 1).ToString()
Write-Host $vc
if ($vc -notmatch "versionCode=$MinVersionCode" -and $vc -notmatch 'versionCode=202630468') {
  Write-Warning "Installed versionCode may be older than expected: $vc"
}

Invoke-Adb shell am force-stop $Package
Invoke-Adb shell am start -n "$Package/.MainActivity" | Out-Null
Start-Sleep 4

$ui = Dump-Ui
$texts = @(Get-Texts $ui)
Write-Host ('HOME texts: ' + (($texts | Select-Object -First 12) -join ' | '))

# Inbox must not show Firebase stub
if (-not (Tap-Text $ui 'Inbox')) { throw 'Inbox tab missing' }
Start-Sleep 2
$ui = Dump-Ui
$inbox = @(Get-Texts $ui)
if ($inbox -match 'temporarily unavailable') { throw 'Inbox still showing messaging stub' }
Write-Host 'PASS: Inbox (no stub)'
if ($inbox -match 'Start New Chat|No conversations|Chats') { Write-Host 'PASS: Inbox chat UI present' }

# Profile -> Edit profile -> settings rows
if (-not (Tap-Text $ui 'Profile')) { throw 'Profile tab missing' }
Start-Sleep 2
$ui = Dump-Ui
if (-not (Tap-Text $ui 'Edit profile')) { throw 'Edit profile missing' }
Start-Sleep 2
$ui = Dump-Ui
foreach ($row in @('Privacy & Security', 'Notification Settings', 'Help & Support')) {
  if (-not (Tap-Text $ui $row)) { throw "$row missing" }
  Start-Sleep 1.5
  $ui = Dump-Ui
  $page = @(Get-Texts $ui)
  if ($page -notcontains $row -and ($page | Where-Object { $_ -like "$row*" }).Count -eq 0) {
    Write-Warning "Opened $row but title not confirmed: $($page -join ' | ')"
  } else {
    Write-Host "PASS: $row"
  }
  Invoke-Adb shell input keyevent 4
  Start-Sleep 1
  $ui = Dump-Ui
}

# Home -> Go live composer
1..3 | ForEach-Object { Invoke-Adb shell input keyevent 4; Start-Sleep 0.3 }
$ui = Dump-Ui
Tap-Text $ui 'Home' | Out-Null
Start-Sleep 2
$ui = Dump-Ui
Invoke-Adb shell input swipe 540 1800 540 900 300
Start-Sleep 1
$ui = Dump-Ui
if (-not (Tap-Text $ui 'Go live')) { throw 'Go live tile missing' }
Start-Sleep 2
$ui = Dump-Ui
$live = @(Get-Texts $ui)
if ($live -match 'turned off|not available yet|Live Unavailable') {
  throw "Live still blocked: $($live -join ' | ')"
}
if ($live -match 'Go Live|What.+Blyp about|broadcast') {
  Write-Host 'PASS: Live composer opened'
} else {
  Write-Host ("Live screen texts: " + ($live -join ' | '))
  throw 'Live composer not confirmed'
}

# Attempt start broadcast (stops at permission/camera if OS prompts)
if (Tap-Text $ui 'Go Live') {
  Start-Sleep 3
  $ui = Dump-Ui
  $after = @(Get-Texts $ui)
  Write-Host ('After Go Live CTA: ' + (($after | Select-Object -First 20) -join ' | '))
  if ($after -match 'Allow|While using|Only this time|Camera|Microphone|Permission') {
    Write-Host 'INFO: OS permission prompt — approve on device to continue live publish'
  }
}

Write-Host 'SMOKE COMPLETE'
