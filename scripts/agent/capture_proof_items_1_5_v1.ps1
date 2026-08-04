# ==============================================================
# VS CODE AGENT COMMAND — CAPTURE_PROOF_ITEMS_1_5_V1
# SAFE: NO PATCH — NO BUILD — EVIDENCE ONLY
#
# Captures proof for:
# 1) For Me preload / scroll latency
# 2) Likes (lights) revert issue
# 3) Comment avatar grey circle
# 4) Chat Games default tab (Rooms vs Live)
# 5) Profile video player zoom/crop issue
#
# OUTPUT:
#   diagnostics\ui\PROOF_ITEMS_1_5_<ts>\*
# ==============================================================

$ErrorActionPreference="Stop"
$PSNativeCommandUseErrorActionPreference=$false
Set-Location C:\Users\Alex\Blyp26

function NowTs(){ Get-Date -Format "yyyyMMdd_HHmmss" }
$ts = NowTs
$root = "diagnostics\ui\PROOF_ITEMS_1_5_$ts"
New-Item -ItemType Directory -Force -Path $root | Out-Null

function W([string]$name, [string[]]$lines){
  $p = Join-Path $root $name
  $lines | Out-File -Encoding utf8 $p
  $p
}

# ---------- ADB / Devices ----------
$adb = "adb"
$devs = @(& $adb devices | Select-String -Pattern "device$" | ForEach-Object { ($_ -split "\s+")[0] })
if(-not $devs -or $devs.Count -eq 0){
  throw "NO_ADB_DEVICES: Connect + authorize at least one Android device, then re-run."
}

# Choose primary device (first). Still log all devices.
$serial = $devs[0]
W "00_summary.txt" @(
  "CAPTURE_PROOF_ITEMS_1_5_V1",
  "TS=$ts",
  "ROOT=$root",
  "PRIMARY_DEVICE=$serial",
  "ALL_DEVICES=$($devs -join ',')",
  "RULES: evidence-only; you will be prompted to perform actions while screen recording."
)

# Try to auto-detect package containing 'blyp' (fallback: leave blank and still capture generic evidence)
$pkg = ""
try {
  $pkgs = & $adb -s $serial shell pm list packages | Out-String
  $match = ($pkgs -split "`n") | Where-Object { $_ -match "package:" } | ForEach-Object { $_.Trim() -replace "^package:","" } | Where-Object { $_ -match "(?i)blyp" }
  if($match -and $match.Count -gt 0){ $pkg = $match[0] }
} catch {}
W "01_app_package_autodetect.txt" @(
  "PRIMARY_DEVICE=$serial",
  "AUTO_DETECTED_PACKAGE=$pkg",
  "NOTE: If blank, the capture still works; it just can't query versionName/versionCode automatically."
)

# Device + build info
$devInfo = @()
$devInfo += "SERIAL=$serial"
$devInfo += "MODEL=$(& $adb -s $serial shell getprop ro.product.model)"
$devInfo += "BRAND=$(& $adb -s $serial shell getprop ro.product.brand)"
$devInfo += "DEVICE=$(& $adb -s $serial shell getprop ro.product.device)"
$devInfo += "ANDROID_RELEASE=$(& $adb -s $serial shell getprop ro.build.version.release)"
$devInfo += "SDK=$(& $adb -s $serial shell getprop ro.build.version.sdk)"
$devInfo += "FINGERPRINT=$(& $adb -s $serial shell getprop ro.build.fingerprint)"
W "02_device_info.txt" $devInfo

# App version info (if package detected)
if($pkg){
  $dumpsys = & $adb -s $serial shell dumpsys package $pkg | Out-String
  $verName = ($dumpsys | Select-String -Pattern "versionName=" | Select-Object -First 1).ToString().Trim()
  $verCode = ($dumpsys | Select-String -Pattern "versionCode=" | Select-Object -First 1).ToString().Trim()
  W "03_app_version.txt" @("PACKAGE=$pkg",$verName,$verCode)
} else {
  W "03_app_version.txt" @("PACKAGE=(not detected)","versionName=(unknown)","versionCode=(unknown)")
}

# Helpers
function EnsureScreenOn(){
  & $adb -s $serial shell svc power stayon true | Out-Null
  & $adb -s $serial shell input keyevent 224 2>$null | Out-Null  # wake
  Start-Sleep -Milliseconds 500
}

function PullUiDump([string]$tag){
  $remote = "/sdcard/ui_$tag.xml"
  & $adb -s $serial shell uiautomator dump $remote | Out-Null
  & $adb -s $serial pull $remote (Join-Path $root "ui_$tag.xml") | Out-Null
}

function PullScreenshot([string]$tag){
  $remote = "/sdcard/ss_$tag.png"
  & $adb -s $serial shell screencap -p $remote | Out-Null
  & $adb -s $serial pull $remote (Join-Path $root "ss_$tag.png") | Out-Null
}

function CaptureLogcatWindow([string]$tag, [int]$seconds){
  $p = Join-Path $root "logcat_$tag.txt"
  # Clear to make the window clean, then capture for N seconds
  & $adb -s $serial logcat -c | Out-Null
  $job = Start-Job -ScriptBlock {
    param($adbPath,$s,$outPath)
    & $adbPath -s $s logcat -v threadtime | Out-File -Encoding utf8 $outPath
  } -ArgumentList $adb,$serial,$p
  Start-Sleep -Seconds $seconds
  try { Stop-Job $job -Force | Out-Null } catch {}
  try { Receive-Job $job | Out-Null } catch {}
  try { Remove-Job $job -Force | Out-Null } catch {}
  return $p
}

function CaptureScreenRecord([string]$tag, [int]$seconds){
  $remote = "/sdcard/rec_$tag.mp4"
  $local  = Join-Path $root "rec_$tag.mp4"

  # Remove any stale file
  & $adb -s $serial shell rm -f $remote 2>$null | Out-Null

  # Start recording (blocking)
  & $adb -s $serial shell screenrecord --bit-rate 8000000 --time-limit $seconds $remote | Out-Null

  # Pull back
  & $adb -s $serial pull $remote $local | Out-Null
  return $local
}

function Prompt([string]$msg){
  Write-Host ""
  Write-Host "=============================================================="
  Write-Host $msg
  Write-Host "=============================================================="
  Read-Host "Press ENTER when ready to start capture"
}

EnsureScreenOn

# Try to open app to reduce friction (safe, generic)
if($pkg){
  & $adb -s $serial shell monkey -p $pkg -c android.intent.category.LAUNCHER 1 | Out-Null
  Start-Sleep -Seconds 2
}

# ---------- Item 1: For Me preload / scroll latency ----------
Prompt "ITEM 1 (For Me preload): Go to For Me feed. Be ready to scroll 6-10 posts smoothly during recording."
PullScreenshot "01_before_for_me_scroll"
PullUiDump     "01_before_for_me_scroll"
$log1 = CaptureLogcatWindow "01_for_me_scroll_window" 35
$rec1 = CaptureScreenRecord "01_for_me_scroll" 30
PullScreenshot "01_after_for_me_scroll"
PullUiDump     "01_after_for_me_scroll"
W "ITEM1_notes.txt" @(
  "ACTION: during rec_01_for_me_scroll.mp4, scroll 6-10 posts.",
  "LOOK FOR: pauses/blank frames/slow start, buffering, repeated network fetches.",
  "FILES: $rec1 ; $log1 ; ss/ui before+after"
)

# ---------- Item 2: Likes revert ----------
Prompt "ITEM 2 (Likes revert): On For Me, pick a post. Tap Like once. Watch if it flips back off. Repeat 2-3 times on different posts."
PullScreenshot "02_before_like"
PullUiDump     "02_before_like"
$log2 = CaptureLogcatWindow "02_like_revert_window" 35
$rec2 = CaptureScreenRecord "02_like_revert" 30
PullScreenshot "02_after_like"
PullUiDump     "02_after_like"
W "ITEM2_notes.txt" @(
  "ACTION: during rec_02_like_revert.mp4, tap Like and observe if it reverts.",
  "LOOK FOR: write failures, auth/user pool mismatch, stale state overwrites.",
  "FILES: $rec2 ; $log2 ; ss/ui before+after"
)

# ---------- Item 3: Comment avatar grey circle ----------
Prompt "ITEM 3 (Comment avatar): On For Me, open comments on a post. Focus the comment box so the avatar should show. Capture the grey circle."
PullScreenshot "03_before_comment"
PullUiDump     "03_before_comment"
$log3 = CaptureLogcatWindow "03_comment_avatar_window" 35
$rec3 = CaptureScreenRecord "03_comment_avatar" 30
PullScreenshot "03_after_comment"
PullUiDump     "03_after_comment"
W "ITEM3_notes.txt" @(
  "ACTION: during rec_03_comment_avatar.mp4, open comment composer; show the avatar area.",
  "LOOK FOR: missing current user profilePhotoUrl binding, null URL, image load errors.",
  "FILES: $rec3 ; $log3 ; ss/ui before+after"
)

# ---------- Item 4: Chat Games defaults to Rooms (should be Live) ----------
Prompt "ITEM 4 (Chat Games default tab): From bottom nav, tap Chat Games. DO NOT change tabs initially. We need what it defaults to."
PullScreenshot "04_before_chatgames"
PullUiDump     "04_before_chatgames"
$log4 = CaptureLogcatWindow "04_chatgames_default_window" 20
$rec4 = CaptureScreenRecord "04_chatgames_default" 15
PullScreenshot "04_after_chatgames"
PullUiDump     "04_after_chatgames"
W "ITEM4_notes.txt" @(
  "ACTION: during rec_04_chatgames_default.mp4, open Chat Games and pause.",
  "LOOK FOR: initial route = Rooms vs Live, navigation config evidence.",
  "FILES: $rec4 ; $log4 ; ss/ui before+after"
)

# ---------- Item 5: Profile video player zoom/crop ----------
Prompt "ITEM 5 (Profile video zoom): Go to any profile, open a video from the profile grid (NOT For Me). Show the zoomed-in playback clearly."
PullScreenshot "05_before_profile_video"
PullUiDump     "05_before_profile_video"
$log5 = CaptureLogcatWindow "05_profile_video_zoom_window" 35
$rec5 = CaptureScreenRecord "05_profile_video_zoom" 30
PullScreenshot "05_after_profile_video"
PullUiDump     "05_after_profile_video"
W "ITEM5_notes.txt" @(
  "ACTION: during rec_05_profile_video_zoom.mp4, open profile video and show zoom/crop.",
  "LOOK FOR: resizeMode/contentFit mismatch, container aspect ratio sizing, style differences vs For Me.",
  "FILES: $rec5 ; $log5 ; ss/ui before+after"
)

# ---------- Focused filtered log extracts (quick signal) ----------
$filter = "BLYP|For Me|FOR_ME|feed|video|player|buffer|preload|cache|like|LIGHT|comment|avatar|profile|photo|image|Rooms|Live|CHATGAMES|navigation|route|IVS|Firestore|Cognito|JWT|401|403|500|error|exception|AndroidRuntime|ReactNative"
Get-ChildItem $root -Filter "logcat_*.txt" | ForEach-Object {
  $src = $_.FullName
  $dst = Join-Path $root ("filtered_" + $_.Name)
  Get-Content $src | Select-String -Pattern $filter | ForEach-Object { $_.Line } | Out-File -Encoding utf8 $dst
}

W "99_done.txt" @(
  "DONE",
  "ROOT=$root",
  "PRIMARY_DEVICE=$serial",
  "NEXT: send me this folder path and tell me which recording shows each bug best:",
  " - rec_01_for_me_scroll.mp4",
  " - rec_02_like_revert.mp4",
  " - rec_03_comment_avatar.mp4",
  " - rec_04_chatgames_default.mp4",
  " - rec_05_profile_video_zoom.mp4"
)

Write-Host ""
Write-Host "EVIDENCE PACKET CREATED:"
Write-Host "  $root"
Write-Host ""
Write-Host "Send me the folder path + any observations (e.g., which post you used for like/comment)."
