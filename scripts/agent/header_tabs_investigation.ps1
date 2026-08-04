# ==============================================================
# HEADER_TABS_NOT_CHANGING_INVESTIGATION_V1
# READ-ONLY — no code mods, no commits
# ==============================================================
$ErrorActionPreference="Stop"
$PSNativeCommandUseErrorActionPreference=$false
Set-Location C:\Users\Alex\Blyp26

function NowTs(){ Get-Date -Format "yyyyMMdd_HHmmss" }
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
function WriteNoBom([string]$p,[string]$c){
  New-Item -ItemType Directory -Force -Path (Split-Path $p) | Out-Null
  [System.IO.File]::WriteAllText($p,$c,$utf8NoBom)
}
function W([string]$p,[string[]]$lines){ WriteNoBom $p ($lines -join "`r`n"); $p }
function Rel([string]$p){ try{ (Resolve-Path $p).Path.Replace((Get-Location).Path + "\", "") } catch { $p } }
function FileUrl([string]$p){
  $full = (Resolve-Path $p).Path -replace "\\","/"
  "file:///$full"
}
function TryRun([scriptblock]$sb){ try{ & $sb } catch { @("ERROR: " + $_.Exception.Message) } }

$ts = NowTs
$rootRel = "diagnostics\state\HEADER_TABS_NOT_CHANGING_$ts"
$root = Join-Path (Get-Location).Path $rootRel
New-Item -ItemType Directory -Force -Path $root | Out-Null

# -------------------------------
# 0) Git state
# -------------------------------
$branch = (git rev-parse --abbrev-ref HEAD)
$head   = (git rev-parse --short HEAD)
W (Join-Path $root "01_git_state.txt") @(
  "BRANCH=$branch"
  "HEAD=$head"
  ""
  "STATUS:"
  (git status --porcelain)
  ""
  "LAST_15_COMMITS:"
  (git log --oneline -15)
)

# -------------------------------
# 1) Devices + package id
# -------------------------------
$gradle = "android\app\build.gradle"
$pkg = ""
if(Test-Path $gradle){
  $g = Get-Content -Raw $gradle
  $m = [regex]::Match($g, '(?m)^\s*applicationId\s+"([^"]+)"')
  if($m.Success){ $pkg = $m.Groups[1].Value }
}
if(-not $pkg){ $pkg = "UNKNOWN_PACKAGE" }

$devices = TryRun { adb devices -l }
W (Join-Path $root "02_devices.txt") (@(
  "ADB_DEVICES:"
) + $devices)

# -------------------------------
# 2) Installed build proof (versionCode/versionName) on ALL devices
# -------------------------------
$inst = New-Object System.Collections.Generic.List[string]
$inst.Add("PACKAGE=$pkg") | Out-Null
$inst.Add("") | Out-Null

$devIds = @()
foreach($line in $devices){
  if($line -match '^\s*([a-zA-Z0-9.:_-]+)\s+device\b'){ $devIds += $Matches[1] }
}
if($devIds.Count -eq 0){
  $inst.Add("NO_DEVICES_FOUND") | Out-Null
} else {
  foreach($d in $devIds){
    $inst.Add("=== DEVICE=$d ===") | Out-Null
    if($pkg -eq "UNKNOWN_PACKAGE"){
      $inst.Add("SKIP: applicationId not detected. Fill it in and re-run.") | Out-Null
      continue
    }
    $out = TryRun { adb -s $d shell dumpsys package $pkg | Select-String -Pattern "versionName=|versionCode=" | ForEach-Object { $_.Line.Trim() } }
    if(-not $out -or ($out -is [string] -and $out -like "ERROR*")){
      $inst.Add("DUMPSYS_FAILED or APP_NOT_INSTALLED") | Out-Null
    } else {
      $out | ForEach-Object { $inst.Add($_) | Out-Null }
    }
    $inst.Add("") | Out-Null
  }
}
W (Join-Path $root "03_installed_build_proof.txt") $inst

# -------------------------------
# 3) Artifact proof: latest AAB + latest UI packet + hashes
# -------------------------------
$aab = "android\app\build\outputs\bundle\release\app-release.aab"
$art = New-Object System.Collections.Generic.List[string]
$art.Add("AAB_PATH=$aab") | Out-Null
if(Test-Path $aab){
  $hash = (Get-FileHash -Algorithm SHA256 $aab).Hash
  $mt = (Get-Item $aab).LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss")
  $len = (Get-Item $aab).Length
  $art.Add("AAB_EXISTS=true") | Out-Null
  $art.Add("AAB_ABS=$((Resolve-Path $aab).Path)") | Out-Null
  $art.Add("AAB_SIZE_BYTES=$len") | Out-Null
  $art.Add("AAB_LAST_WRITE=$mt") | Out-Null
  $art.Add("AAB_SHA256=$hash") | Out-Null
} else {
  $art.Add("AAB_EXISTS=false") | Out-Null
}
$latestRail = Get-ChildItem diagnostics\release_aab -Directory -ErrorAction SilentlyContinue |
  Where-Object Name -like "AAB_RAIL_*" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if($latestRail){
  $art.Add("") | Out-Null
  $art.Add("LATEST_AAB_RAIL_PACKET=$($latestRail.FullName)") | Out-Null
  $sum = Join-Path $latestRail.FullName "00_summary.txt"
  if(Test-Path $sum){
    $art.Add("--- 00_summary.txt ---") | Out-Null
    (Get-Content $sum) | ForEach-Object { $art.Add($_) | Out-Null }
  } else {
    $art.Add("00_summary.txt NOT FOUND in latest rail packet") | Out-Null
  }
} else {
  $art.Add("") | Out-Null
  $art.Add("NO_AAB_RAIL_PACKET_FOUND") | Out-Null
}
W (Join-Path $root "04_artifact_proof.txt") $art

# -------------------------------
# 4) UI commit presence + what changed in the key files
# -------------------------------
$ui = New-Object System.Collections.Generic.List[string]
$ui.Add("KEY_FILES:") | Out-Null
$ui.Add(" - src/components/HeaderMenuTabs.tsx") | Out-Null
$ui.Add(" - src/components/BlypHeaderFlow.js") | Out-Null
$ui.Add(" - src/components/HeaderContainer.js") | Out-Null
$ui.Add("") | Out-Null

$ui.Add("RECENT_COMMITS_TOUCHING_HEADER_FILES:") | Out-Null
$hits = TryRun { git log --oneline -80 -- "src/components/HeaderMenuTabs.tsx" "src/components/BlypHeaderFlow.js" "src/components/HeaderContainer.js" }
if($hits){ $hits | ForEach-Object { $ui.Add($_) | Out-Null } } else { $ui.Add("NO_MATCHES") | Out-Null }

$ui.Add("") | Out-Null
$ui.Add("LAST_CHANGE_TO_FILES:") | Out-Null
foreach($f in @("src/components/HeaderMenuTabs.tsx","src/components/BlypHeaderFlow.js","src/components/HeaderContainer.js")){
  if(Test-Path $f){
    $ui.Add("---- $f ----") | Out-Null
    (git log -n 5 --oneline -- $f) | ForEach-Object { $ui.Add($_) | Out-Null }
    $ui.Add("") | Out-Null
  } else {
    $ui.Add("MISSING: $f") | Out-Null
  }
}
W (Join-Path $root "05_ui_commit_presence.txt") $ui

# -------------------------------
# 5) Source map: where HeaderMenuTabs is rendered from
# -------------------------------
$map = New-Object System.Collections.Generic.List[string]
$map.Add("FIND_RENDER_CALLS_FOR_HeaderMenuTabs") | Out-Null
$map.Add("") | Out-Null

$srcFiles = Get-ChildItem -Recurse -File src -Include *.js,*.jsx,*.ts,*.tsx |
  Where-Object { $_.FullName -notmatch "\\node_modules\\|\\android\\|\\ios\\|\\dist\\|\\build\\|\\coverage\\" } |
  Select-Object -ExpandProperty FullName

if($srcFiles -and $srcFiles.Count -gt 0){
  $callers = Select-String -Path $srcFiles -Pattern "<HeaderMenuTabs\b" -ErrorAction SilentlyContinue

  if($callers){
    foreach($c in $callers){
      $map.Add(("{0}:{1} :: {2}" -f (Rel $c.Path), $c.LineNumber, $c.Line.Trim())) | Out-Null
    }
  } else {
    $map.Add("NO_USAGES_FOUND (unexpected)") | Out-Null
  }
  $map.Add("") | Out-Null
  $map.Add("FIND_IMPORTS_OF_HeaderMenuTabs") | Out-Null
  $imports = Select-String -Path $srcFiles -Pattern "HeaderMenuTabs" -ErrorAction SilentlyContinue | Select-Object -First 200
  if($imports){
    foreach($i in $imports){
      $map.Add(("{0}:{1} :: {2}" -f (Rel $i.Path), $i.LineNumber, $i.Line.Trim())) | Out-Null
    }
  } else {
    $map.Add("NO_IMPORTS_FOUND") | Out-Null
  }
} else {
  $map.Add("NO_SRC_FILES_FOUND") | Out-Null
}
W (Join-Path $root "06_header_tabs_source_map.txt") $map

# -------------------------------
# 6) Marker scan in source (what should visibly change)
# -------------------------------
$markers = New-Object System.Collections.Generic.List[string]
$markers.Add("SOURCE_MARKERS (expect to see these in source):") | Out-Null
$markers.Add(" - tabsDock / flowStyles.tabsDock in BlypHeaderFlow") | Out-Null
$markers.Add(" - height: 36 / lineHeight: 20 / includeFontPadding: false in HeaderMenuTabs") | Out-Null
$markers.Add("") | Out-Null

$targets = @("src/components/HeaderMenuTabs.tsx","src/components/BlypHeaderFlow.js","src/components/HeaderContainer.js") | Where-Object { Test-Path $_ }

function MarkHit($label,$pat){
  $script:markers.Add("=== $label ===") | Out-Null
  if($targets -and $targets.Count -gt 0){
    $h = Select-String -Path $targets -Pattern $pat -ErrorAction SilentlyContinue
    if($h){
      foreach($x in $h){ $script:markers.Add(("{0}:{1} :: {2}" -f (Rel $x.Path), $x.LineNumber, $x.Line.Trim())) | Out-Null }
    } else { $script:markers.Add("NO_HITS") | Out-Null }
  } else {
    $script:markers.Add("NO_TARGET_FILES") | Out-Null
  }
  $script:markers.Add("") | Out-Null
}

MarkHit "tabsDock markers" "tabsDock|flowStyles\.tabsDock"
MarkHit "tab height / centering markers" "height:\s*36|justifyContent:\s*'center'|alignItems:\s*'center'"
MarkHit "text baseline markers" "includeFontPadding:\s*false|textAlignVertical:\s*'center'|lineHeight:\s*20"
MarkHit "marginTop / paddingTop around tabs" "marginTop|paddingTop"
W (Join-Path $root "07_marker_scan_source.txt") $markers

# -------------------------------
# 7) Bundle marker scan
# -------------------------------
$bundle = "android\app\build\generated\assets\react\release\index.android.bundle"
$bm = New-Object System.Collections.Generic.List[string]
$bm.Add("BUNDLE_PATH=$bundle") | Out-Null
if(Test-Path $bundle){
  $bm.Add("BUNDLE_EXISTS=true") | Out-Null
  $bm.Add("BUNDLE_MTIME=$((Get-Item $bundle).LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss"))") | Out-Null
  $bm.Add("") | Out-Null
  foreach($pat in @("tabsDock","flowStyles","includeFontPadding","textAlignVertical","lineHeight")){
    $hit = Select-String -Path $bundle -Pattern $pat -ErrorAction SilentlyContinue | Select-Object -First 10
    $bm.Add("=== FIND: $pat ===") | Out-Null
    if($hit){ $hit | ForEach-Object { $bm.Add(("{0}:{1} :: {2}" -f (Rel $_.Path), $_.LineNumber, $_.Line.Trim())) | Out-Null } }
    else { $bm.Add("NO_HITS") | Out-Null }
    $bm.Add("") | Out-Null
  }
} else {
  $bm.Add("BUNDLE_EXISTS=false (normal if you haven't built since changes)") | Out-Null
}
W (Join-Path $root "08_bundle_marker_scan.txt") $bm

# -------------------------------
# Summary + next actions
# -------------------------------
$nextActions = New-Object System.Collections.Generic.List[string]
$nextActions.Add("NEXT_ACTIONS (based on what this finds):") | Out-Null
$nextActions.Add(" - If devices show OLD versionCode => you didn't install the new build.") | Out-Null
$nextActions.Add(" - If AAB hash/mtime unchanged => you are reusing the same artifact.") | Out-Null
$nextActions.Add(" - If HeaderMenuTabs renders from a DIFFERENT file => you have been editing the wrong component.") | Out-Null
$nextActions.Add(" - If bundle lacks markers but source has them => you didn't rebuild after changes.") | Out-Null
W (Join-Path $root "09_next_actions.txt") $nextActions

$sumLines = New-Object System.Collections.Generic.List[string]
$sumLines.Add("RESULT=PASS") | Out-Null
$sumLines.Add("PACKET_REL=$rootRel") | Out-Null
$sumLines.Add("BRANCH=$branch") | Out-Null
$sumLines.Add("HEAD=$head") | Out-Null
$sumLines.Add("PACKAGE=$pkg") | Out-Null
$sumLines.Add("") | Out-Null
$sumLines.Add("KEY_EVIDENCE:") | Out-Null
$sumLines.Add(" - 01_git_state.txt") | Out-Null
$sumLines.Add(" - 02_devices.txt") | Out-Null
$sumLines.Add(" - 03_installed_build_proof.txt") | Out-Null
$sumLines.Add(" - 04_artifact_proof.txt") | Out-Null
$sumLines.Add(" - 05_ui_commit_presence.txt") | Out-Null
$sumLines.Add(" - 06_header_tabs_source_map.txt") | Out-Null
$sumLines.Add(" - 07_marker_scan_source.txt") | Out-Null
$sumLines.Add(" - 08_bundle_marker_scan.txt") | Out-Null
$sumLines.Add(" - 09_next_actions.txt") | Out-Null
WriteNoBom (Join-Path $root "00_summary.txt") ($sumLines -join "`r`n")

Write-Output "PASS. PACKET=$rootRel"
Write-Output ("OPEN: " + (FileUrl (Join-Path $root "00_summary.txt")))
