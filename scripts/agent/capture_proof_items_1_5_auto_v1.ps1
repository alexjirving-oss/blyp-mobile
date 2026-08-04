$ErrorActionPreference="Stop"
$PSNativeCommandUseErrorActionPreference=$false
Set-Location C:\Users\Alex\Blyp26

function NowTs(){ Get-Date -Format "yyyyMMdd_HHmmss" }
$ts = NowTs
$root = "diagnostics\ui\PROOF_ITEMS_1_5_AUTO_$ts"
New-Item -ItemType Directory -Force -Path $root | Out-Null

function W([string]$name, [string[]]$lines){
  $p = Join-Path $root $name
  $lines | Out-File -Encoding utf8 $p
  $p
}

# 0) Unstick any prior interactive run (best effort)
try { Get-Process -Name powershell -ErrorAction SilentlyContinue | Out-Null } catch {}
try { adb shell pkill -f "screenrecord" 2>$null | Out-Null } catch {}
try { adb shell rm -f /sdcard/rec_*.mp4 /sdcard/ui_*.xml /sdcard/ss_*.png 2>$null | Out-Null } catch {}

# 1) Device
$devs = @(adb devices | Select-String -Pattern "device$" | ForEach-Object { ($_ -split "\s+")[0] })
if(-not $devs -or $devs.Count -eq 0){ throw "NO_ADB_DEVICES" }
$serial = $devs[0]

# 2) Package autodetect
$pkg = ""
try {
  $pkgs = adb -s $serial shell pm list packages | Out-String
  $allPkgs = @(
    ($pkgs -split "`r?`n") |
      ForEach-Object { $_.Trim() } |
      Where-Object { $_ -match "^package:[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$" } |
      ForEach-Object { $_ -replace "^package:","" }
  )

  $preferred = @($allPkgs | Where-Object { $_ -match "(?i)^com\.blyp" })
  if($preferred.Count -gt 0){
    $pkg = $preferred[0]
  } else {
    $match = @($allPkgs | Where-Object { $_ -match "(?i)blyp" })
    if($match.Count -gt 0){ $pkg = $match[0] }
  }
} catch {}

W "00_summary.txt" @(
  "PROOF_ITEMS_1_5_AUTORUNNER_V1",
  "TS=$ts",
  "ROOT=$root",
  "PRIMARY_DEVICE=$serial",
  "AUTO_DETECTED_PACKAGE=$pkg"
)

# 3) Device info
W "01_device_info.txt" @(
  "MODEL=$(adb -s $serial shell getprop ro.product.model)",
  "ANDROID_RELEASE=$(adb -s $serial shell getprop ro.build.version.release)",
  "SDK=$(adb -s $serial shell getprop ro.build.version.sdk)",
  "FINGERPRINT=$(adb -s $serial shell getprop ro.build.fingerprint)"
)

# 4) App version
if($pkg){
  $dumpsys = adb -s $serial shell dumpsys package $pkg | Out-String
  $verName = ($dumpsys | Select-String "versionName=" | Select-Object -First 1).ToString().Trim()
  $verCode = ($dumpsys | Select-String "versionCode=" | Select-Object -First 1).ToString().Trim()
  W "02_app_version.txt" @("PACKAGE=$pkg",$verName,$verCode)
} else {
  W "02_app_version.txt" @("PACKAGE=(not detected)")
}

function PullUi([string]$tag){
  $remote = "/sdcard/ui_$tag.xml"
  adb -s $serial shell uiautomator dump $remote | Out-Null
  adb -s $serial pull $remote (Join-Path $root "ui_$tag.xml") | Out-Null
}
function PullSs([string]$tag){
  $remote = "/sdcard/ss_$tag.png"
  adb -s $serial shell screencap -p $remote | Out-Null
  adb -s $serial pull $remote (Join-Path $root "ss_$tag.png") | Out-Null
}
function ScreenRec([string]$tag,[int]$sec){
  $remote="/sdcard/rec_$tag.mp4"
  $local=Join-Path $root "rec_$tag.mp4"
  adb -s $serial shell rm -f $remote 2>$null | Out-Null
  adb -s $serial shell screenrecord --bit-rate 8000000 --time-limit $sec $remote | Out-Null
  adb -s $serial pull $remote $local | Out-Null
  return $local
}
function LogWindow([string]$tag,[int]$sec){
  $out = Join-Path $root "logcat_$tag.txt"
  adb -s $serial logcat -c | Out-Null
  $job = Start-Job -ScriptBlock {
    param($s,$o)
    adb -s $s logcat -v threadtime | Out-File -Encoding utf8 $o
  } -ArgumentList $serial,$out
  Start-Sleep -Seconds $sec
  try { Stop-Job $job -Force | Out-Null } catch {}
  try { Receive-Job $job | Out-Null } catch {}
  try { Remove-Job $job -Force | Out-Null } catch {}
  return $out
}

# 5) Launch app
if($pkg){
  $launched = $false
  for($attempt=1; $attempt -le 5; $attempt++){
    try {
      adb -s $serial wait-for-device | Out-Null
      adb -s $serial shell am force-stop $pkg | Out-Null
      Start-Sleep -Milliseconds 600
      $resolveOut = adb -s $serial shell cmd package resolve-activity --brief $pkg | Out-String
      $launchComponent = ""
      if($resolveOut){
        $lines = ($resolveOut -split "`r?`n") | ForEach-Object { $_.Trim() } | Where-Object { $_ }
        $launchComponent = ($lines | Where-Object { $_ -match "/" } | Select-Object -Last 1)
      }
      if(-not $launchComponent){
        throw "APP_LAUNCH_COMPONENT_NOT_FOUND: $resolveOut"
      }
      $startOut = adb -s $serial shell am start -W -n $launchComponent | Out-String
      if($startOut -match "Error|Exception|No Activity found|does not exist|unable to resolve Intent"){
        throw "APP_LAUNCH_FAILED: $startOut"
      }
      $launched = $true
      break
    } catch {
      if($attempt -eq 5){ throw }
      Start-Sleep -Seconds 2
    }
  }
  if(-not $launched){
    throw "APP_LAUNCH_FAILED for package $pkg"
  }
  Start-Sleep -Seconds 3
}

# 6) Auto-navigation strategy (generic, robust):
#    Use simple swipe/tap patterns + UI dumps between steps.
#    (If any step doesn't land perfectly, the recording + UI dump still proves state.)

# Ensure awake
adb -s $serial shell svc power stayon true | Out-Null
adb -s $serial shell input keyevent 224 2>$null | Out-Null
Start-Sleep -Milliseconds 500

# ---------- ITEM 1: For Me scroll latency ----------
PullSs "01_before_for_me_scroll"; PullUi "01_before_for_me_scroll"
$log1 = LogWindow "01_for_me_scroll_window" 40

# Do 8 fast swipes then take a 30s capture
for($i=0;$i -lt 8;$i++){
  adb -s $serial shell input swipe 540 1700 540 300 180 | Out-Null
  Start-Sleep -Milliseconds 650
}
$rec1 = ScreenRec "01_for_me_scroll" 30
PullSs "01_after_for_me_scroll"; PullUi "01_after_for_me_scroll"
W "ITEM1_notes.txt" @("rec=$rec1","log=$log1")

# ---------- ITEM 2: Like revert ----------
# Try tap on right-side like area (approx). Repeat 3 times with pauses.
PullSs "02_before_like"; PullUi "02_before_like"
$log2 = LogWindow "02_like_revert_window" 40
for($i=0;$i -lt 3;$i++){
  adb -s $serial shell input tap 980 980 | Out-Null
  Start-Sleep -Seconds 2
}
$rec2 = ScreenRec "02_like_revert" 30
PullSs "02_after_like"; PullUi "02_after_like"
W "ITEM2_notes.txt" @("rec=$rec2","log=$log2","tap=980,980 (adjust later if needed)")

# ---------- ITEM 3: Comment avatar ----------
# Tap comment button area (approx), then tap comment field.
PullSs "03_before_comment"; PullUi "03_before_comment"
$log3 = LogWindow "03_comment_avatar_window" 40
adb -s $serial shell input tap 980 1130 | Out-Null   # comment icon area (approx)
Start-Sleep -Seconds 2
adb -s $serial shell input tap 350 1700 | Out-Null   # comment input (approx)
Start-Sleep -Seconds 3
$rec3 = ScreenRec "03_comment_avatar" 30
PullSs "03_after_comment"; PullUi "03_after_comment"
W "ITEM3_notes.txt" @("rec=$rec3","log=$log3","taps=980,1130 then 350,1700 (adjust later if needed)")

# Close comments (back)
adb -s $serial shell input keyevent 4 | Out-Null
Start-Sleep -Seconds 1

# ---------- ITEM 4: Chat Games default tab ----------
# Tap bottom nav "Chat Games" position (approx), then record short.
PullSs "04_before_chatgames"; PullUi "04_before_chatgames"
$log4 = LogWindow "04_chatgames_default_window" 25
adb -s $serial shell input tap 650 2060 | Out-Null   # bottom nav middle-right (approx)
Start-Sleep -Seconds 2
$rec4 = ScreenRec "04_chatgames_default" 15
PullSs "04_after_chatgames"; PullUi "04_after_chatgames"
W "ITEM4_notes.txt" @("rec=$rec4","log=$log4","tap=650,2060 (adjust later if needed)")

# ---------- ITEM 5: Profile video zoom ----------
# Go back home, open profile tab, tap first grid video (approx).
adb -s $serial shell input keyevent 4 | Out-Null
Start-Sleep -Seconds 1
adb -s $serial shell input tap 980 2060 | Out-Null   # profile tab (far right approx)
Start-Sleep -Seconds 3

PullSs "05_before_profile_video"; PullUi "05_before_profile_video"
$log5 = LogWindow "05_profile_video_zoom_window" 40
adb -s $serial shell input tap 220 1100 | Out-Null   # first grid tile (approx)
Start-Sleep -Seconds 4
$rec5 = ScreenRec "05_profile_video_zoom" 30
PullSs "05_after_profile_video"; PullUi "05_after_profile_video"
W "ITEM5_notes.txt" @("rec=$rec5","log=$log5","tap=220,1100 (adjust later if needed)")

# Filter logs
$filter = "BLYP|For Me|FOR_ME|feed|video|player|buffer|preload|cache|like|LIGHT|comment|avatar|profile|photo|image|Rooms|Live|CHATGAMES|navigation|route|Firestore|Cognito|JWT|401|403|500|error|exception|AndroidRuntime|ReactNative"
Get-ChildItem $root -Filter "logcat_*.txt" | ForEach-Object {
  $src = $_.FullName
  $dst = Join-Path $root ("filtered_" + $_.Name)
  Get-Content $src | Select-String -Pattern $filter | ForEach-Object { $_.Line } | Out-File -Encoding utf8 $dst
}

W "99_done.txt" @("DONE","ROOT=$root","PRIMARY_DEVICE=$serial")
Write-Host "`nDONE. ROOT=$root`n"
