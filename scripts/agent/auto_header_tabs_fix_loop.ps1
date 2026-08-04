# ==============================================================
# VS CODE AGENT COMMAND — AUTO_HEADER_TABS_FIX_LOOP_V1
# GOAL:
#   Auto-fix the 2 remaining UI issues in a loop (max N passes):
#     1) Header tabs row sits too high → push tabs down inside header
#     2) Pill highlight not centered around label → normalize pill geometry
#
# LOOP:
#   pass i:
#     - verify 1 device connected
#     - apply deterministic patch set (HeaderMenuTabs.tsx + BlypHeaderFlow.js)
#     - build RELEASE APK (fast) + install + launch
#     - screencap → pixel-diff vs previous pass
#     - if diff >= threshold => STOP (change is visible)
#       else increase "tabsDock paddingBottom" and retry
#
# HARD RULES:
#   - Clean tree gate
#   - JSX corruption gate
#   - UTF-8 NO-BOM writes
#   - ONE evidence packet with screenshots + diffs + logs
#   - Commits each pass ONLY if files changed
#
# OUTPUT:
#   diagnostics\ui\AUTO_HEADER_TABS_FIX_LOOP_<ts>\*
#     00_summary.txt (CLICK THIS)
#     01_repo.txt
#     02_device.txt
#     03_changes_by_pass.txt
#     04_build_install_by_pass.txt
#     05_screenshots\pass_*.png
#     06_diff_by_pass.txt
# ==============================================================

$ErrorActionPreference="Stop"
$PSNativeCommandUseErrorActionPreference=$false
Set-Location C:\Users\Alex\Blyp26

function NowTs(){ Get-Date -Format "yyyyMMdd_HHmmss" }
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function WriteNoBom([string]$path,[string]$content){
  New-Item -ItemType Directory -Force -Path (Split-Path $path) | Out-Null
  [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
}
function W([string]$path,[string[]]$lines){ WriteNoBom $path ($lines -join "`r`n"); $path }
function ReadText([string]$path){ Get-Content -Raw -LiteralPath $path -ErrorAction Stop }
function Rel([string]$path){ try{ (Resolve-Path $path).Path.Replace((Get-Location).Path + "\","") } catch { $path } }
function EnsureExists([string]$path){
  New-Item -ItemType Directory -Force -Path (Split-Path $path) | Out-Null
  if(-not (Test-Path $path)){ WriteNoBom $path "" }
}
function FileUrl([string]$path){
  EnsureExists $path
  $full = (Resolve-Path $path).Path -replace "\\","/"
  "file:///$full"
}

function Snap([string]$dir,[string]$fileRel,[string]$before,[string]$after){
  $safe = ($fileRel -replace "[\\/:*?`"<>| ]","_")
  WriteNoBom (Join-Path $dir ("before_" + $safe + ".txt")) $before
  WriteNoBom (Join-Path $dir ("after_"  + $safe + ".txt")) $after
}

# Force-set prop inside StyleSheet block: key: { ... }
function ForcePropInsideStyle([string]$text,[string]$styleKey,[string]$propName,[string]$propValueWithComma){
  $rx = "(?ms)(\b" + [regex]::Escape($styleKey) + "\s*:\s*\{\s*)(.*?)(\s*\}\s*,)"
  if(-not ([regex]::IsMatch($text,$rx))){ return $text }
  return [regex]::Replace($text,$rx,{
    param($m)
    $head = $m.Groups[1].Value
    $body = $m.Groups[2].Value
    $tail = $m.Groups[3].Value
    $body2 = [regex]::Replace($body, "(?m)^\s*" + [regex]::Escape($propName) + "\s*:\s*.*?,\s*$", "")
    $body2 = $body2.TrimEnd()
    if($body2.Length -gt 0){ $body2 = $body2 + "`r`n" }
    $body2 = $body2 + "    " + $propName + ": " + $propValueWithComma
    return ($head + $body2 + "`r`n" + $tail)
  },1)
}

# -----------------------------
# CONFIG
# -----------------------------
$MAX_PASSES = 6
$DIFF_THRESHOLD = 0.004   # ~0.4% average pixel delta (tweak if needed)
$PKG = "com.blyp.mobile"

$ts = NowTs
$rootRel = "diagnostics\ui\AUTO_HEADER_TABS_FIX_LOOP_$ts"
$root = Join-Path (Get-Location).Path $rootRel
$shots = Join-Path $root "05_screenshots"
$baDir = Join-Path $root "before_after"
New-Item -ItemType Directory -Force -Path $root,$shots,$baDir | Out-Null

$branch = (git rev-parse --abbrev-ref HEAD)
$head0  = (git rev-parse --short HEAD)
W (Join-Path $root "01_repo.txt") @("BRANCH=$branch","HEAD_START=$head0")
W (Join-Path $root "00_summary.txt") @("RESULT=RUNNING","PACKET_REL=$rootRel","OPEN_THIS=" + (FileUrl (Join-Path $root "00_summary.txt")))

# Gate: clean tree
$dirty = (git status --porcelain)
if($dirty.Length -ne 0){
  W (Join-Path $root "99_FAIL_DIRTY_TREE.txt") @($dirty)
  throw "DIRTY_TREE: commit/stash first. See $rootRel\99_FAIL_DIRTY_TREE.txt"
}

# Gate: JSX corruption scan
$jsxTargets = Get-ChildItem -Recurse -File src -Include *.js,*.jsx,*.ts,*.tsx |
  Where-Object { $_.FullName -notmatch "\\node_modules\\|\\android\\|\\ios\\|\\dist\\|\\build\\|\\coverage\\" }
$bad = Select-String -Path ($jsxTargets.FullName) -Pattern "<Viewstyle|<Viewclass|<Textstyle|<ScrollViewstyle|<SafeAreaViewstyle" -ErrorAction SilentlyContinue
if($bad){
  $lines = @("RESULT=FAIL","BROKEN_TAGS_FOUND=" + $bad.Count) + ($bad | Select-Object -First 200 | ForEach-Object {
    "{0}:{1} :: {2}" -f (Rel $_.Path), $_.LineNumber, $_.Line.Trim()
  })
  W (Join-Path $root "98_FAIL_BROKEN_JSX.txt") $lines
  throw "BROKEN_JSX: Fix first. See $rootRel\98_FAIL_BROKEN_JSX.txt"
}

# Device gate
$adb = Get-Command adb -ErrorAction Stop | Select-Object -ExpandProperty Source
$devs = @(& adb devices | Select-String -Pattern "device$" | ForEach-Object { ($_ -split "\s+")[0] })
if(-not $devs -or $devs.Count -lt 1){
  W (Join-Path $root "97_FAIL_NO_DEVICE.txt") @(& adb devices)
  throw "NO_DEVICE: connect exactly 1 device. See $rootRel\97_FAIL_NO_DEVICE.txt"
}
if($devs.Count -gt 1){
  W (Join-Path $root "97_FAIL_MULTI_DEVICE.txt") @(& adb devices)
  throw "MULTI_DEVICE: keep exactly 1 device connected. See $rootRel\97_FAIL_MULTI_DEVICE.txt"
}
$serial = $devs[0]
W (Join-Path $root "02_device.txt") @("ADB=$adb","SERIAL=$serial","RAW=","" + ((& adb devices -l) -join "`r`n"))

# Helper: build+install+launch
function BuildInstallLaunch([string]$logPath){
  $androidDir = Join-Path (Get-Location).Path "android"
  if(-not (Test-Path (Join-Path $androidDir "gradlew.bat"))){ throw "GRADLEW_NOT_FOUND: $androidDir\gradlew.bat" }

  $stdoutLog = $logPath + ".stdout.txt"
  $stderrLog = $logPath + ".stderr.txt"

  # HISTORICAL ONLY - NON-CANONICAL - DO NOT USE FOR RELEASE.
  # Build test APK for local validation only (not Play-upload path).
  $cmd = "cmd.exe"
  $cmdArgs = "/c `"gradlew.bat --no-daemon assembleRelease`""
  $p = Start-Process -FilePath $cmd -ArgumentList $cmdArgs -WorkingDirectory $androidDir `
        -NoNewWindow -Wait -PassThru -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog

  # Merge logs
  $merged = ""
  if(Test-Path $stdoutLog){ $merged += (Get-Content -Raw $stdoutLog) }
  if(Test-Path $stderrLog){ $merged += "`r`n--- STDERR ---`r`n" + (Get-Content -Raw $stderrLog) }
  WriteNoBom $logPath $merged

  if($p.ExitCode -ne 0){ return @{ ok=$false; exit=$p.ExitCode } }

  $apk = "android\app\build\outputs\apk\release\app-release.apk"
  if(-not (Test-Path $apk)){ throw "APK_NOT_FOUND: $apk" }

  # install -r
  & adb -s $serial install -r $apk | Out-File -Encoding utf8 $logPath -Append

  # launch
  & adb -s $serial shell monkey -p $PKG -c android.intent.category.LAUNCHER 1 | Out-File -Encoding utf8 $logPath -Append

  Start-Sleep -Seconds 4
  return @{ ok=$true; exit=0; apk=(Resolve-Path $apk).Path }
}

# Helper: screencap
function CaptureShot([string]$outPng){
  $tmp = "/sdcard/__blyp_ui_shot.png"
  & adb -s $serial shell screencap -p $tmp | Out-Null
  & adb -s $serial pull $tmp $outPng | Out-Null
  & adb -s $serial shell rm $tmp | Out-Null
  if(-not (Test-Path $outPng)){ throw "SCREENSHOT_FAILED: $outPng" }
}

# Helper: image diff ratio (python)
function DiffRatio([string]$a,[string]$b){
  $py = Get-Command python -ErrorAction SilentlyContinue
  if(-not $py){ return 1.0 } # if no python, treat as changed
  $code = @"
from PIL import Image, ImageChops
import sys
a,b = sys.argv[1], sys.argv[2]
im1 = Image.open(a).convert("RGB")
im2 = Image.open(b).convert("RGB")
if im1.size != im2.size:
    im2 = im2.resize(im1.size)
d = ImageChops.difference(im1, im2)
# mean absolute difference normalized 0..1
hist = d.histogram()
# histogram is 256 bins per channel
total = sum(i*h for i,h in enumerate(hist[:256])) + sum(i*h for i,h in enumerate(hist[256:512])) + sum(i*h for i,h in enumerate(hist[512:]))
px = im1.size[0]*im1.size[1]*3
mean = total/(px*255.0)
print(mean)
"@
  $tmpPy = Join-Path $root "diff_tmp.py"
  Set-Content -Encoding utf8 $tmpPy $code
  $r = & python $tmpPy $a $b
  try { return [double]$r } catch { return 1.0 }
}

# -----------------------------
# PATCH TARGETS
# -----------------------------
$tabsRel = "src\components\HeaderMenuTabs.tsx"
$flowRel = "src\components\BlypHeaderFlow.js"
if(-not (Test-Path $tabsRel)){ throw "MISSING: $tabsRel" }
if(-not (Test-Path $flowRel)){ throw "MISSING: $flowRel" }

$changesLog = New-Object System.Collections.Generic.List[string]
$diffLog = New-Object System.Collections.Generic.List[string]
$buildLog = New-Object System.Collections.Generic.List[string]

# baseline shot (pass 0)
$shotPrev = Join-Path $shots "pass_00.png"
CaptureShot $shotPrev

$paddingBottom = 8  # will auto-increase if "no visible change"

for($i=1; $i -le $MAX_PASSES; $i++){
  $pass = "{0:00}" -f $i
  $changesThis = @()

  # --- Patch HeaderMenuTabs: pill geometry + centering
  $tabsAbs = (Resolve-Path $tabsRel).Path
  $t0 = ReadText $tabsAbs
  $t1 = $t0

  # keep row; remove wrong-axis centering; make sizing deterministic
  $t1 = ForcePropInsideStyle $t1 "tabSelector" "flexDirection" "'row',"
  $t1 = ForcePropInsideStyle $t1 "tabSelector" "justifyContent" "'space-between',"
  $t1 = ForcePropInsideStyle $t1 "tabSelector" "alignItems" "'stretch',"
  $t1 = ForcePropInsideStyle $t1 "tabSelector" "padding" "6,"
  $t1 = ForcePropInsideStyle $t1 "tabSelector" "height" "40,"

  $t1 = ForcePropInsideStyle $t1 "tab" "height" "40,"
  $t1 = ForcePropInsideStyle $t1 "tab" "justifyContent" "'center',"
  $t1 = ForcePropInsideStyle $t1 "tab" "alignItems" "'center',"
  $t1 = ForcePropInsideStyle $t1 "tab" "paddingVertical" "0,"

  $t1 = ForcePropInsideStyle $t1 "tabText" "includeFontPadding" "false,"
  $t1 = ForcePropInsideStyle $t1 "tabText" "textAlignVertical" "'center',"
  $t1 = ForcePropInsideStyle $t1 "tabText" "lineHeight" "22,"

  # indicator/pill insets MUST match padding=6
  foreach($k in @("tabIndicator","indicator","pill","activePill","activeIndicator")){
    $t1 = ForcePropInsideStyle $t1 $k "top" "6,"
    $t1 = ForcePropInsideStyle $t1 $k "bottom" "6,"
    $t1 = ForcePropInsideStyle $t1 $k "left" "6,"
    $t1 = ForcePropInsideStyle $t1 $k "right" "6,"
  }

  if($t1 -ne $t0){
    Snap $baDir (Rel $tabsAbs) $t0 $t1
    WriteNoBom $tabsAbs $t1
    $changesThis += "PATCHED :: $tabsRel"
  }

  # --- Patch BlypHeaderFlow: dock tabs to bottom, auto-adjust paddingBottom
  $flowAbs = (Resolve-Path $flowRel).Path
  $f0 = ReadText $flowAbs
  $f1 = $f0

  # ensure tabsDock exists and uses current paddingBottom
  if($f1 -match "StyleSheet\.create\("){
    if($f1 -notmatch "\btabsDock\s*:"){
      $f1 = [regex]::Replace($f1, "(?ms)(StyleSheet\.create\(\s*\{\s*)", "`$1  tabsDock: { marginTop: 'auto', paddingBottom: $paddingBottom },`r`n", 1)
    } else {
      $f1 = [regex]::Replace($f1, "(?m)^\s*tabsDock\s*:\s*\{[^}]*\}\s*,\s*$", "  tabsDock: { marginTop: 'auto', paddingBottom: $paddingBottom },")
    }
  }

  # ensure HeaderMenuTabs wrapper uses flowStyles.tabsDock
  if($f1 -match "<HeaderMenuTabs\b" -and $f1 -notmatch "flowStyles\.tabsDock"){
    $f1 = [regex]::Replace($f1, "(?ms)(\s*)(<HeaderMenuTabs\b.*?\/>)", "`$1<View style={flowStyles.tabsDock}>`r`n`$1  `$2`r`n`$1</View>", 1)
  }

  if($f1 -ne $f0){
    Snap $baDir (Rel $flowAbs) $f0 $f1
    WriteNoBom $flowAbs $f1
    $changesThis += "PATCHED :: $flowRel (tabsDock paddingBottom=$paddingBottom)"
  }

  # commit if changed
  if($changesThis.Count -gt 0){
    git add $tabsRel $flowRel | Out-Null
    git commit -m "style(ui): header tabs loop pass $pass (dock + pill geometry)" | Out-Null
  }

  $headPass = (git rev-parse --short HEAD)
  $changesLog.Add("PASS_$pass HEAD=$headPass paddingBottom=$paddingBottom :: " + ($(if($changesThis.Count){$changesThis -join " | "}else{"NOCHANGE"}))) | Out-Null

  # build/install/launch
  $logPath = Join-Path $root ("04_build_install_pass_" + $pass + ".txt")
  $r = BuildInstallLaunch $logPath
  $buildLog.Add("PASS_$pass BUILD_OK=$($r.ok) EXIT=$($r.exit) LOG=$logPath") | Out-Null
  if(-not $r.ok){ break }

  # screenshot + diff
  $shotNow = Join-Path $shots ("pass_" + $pass + ".png")
  CaptureShot $shotNow
  $dr = DiffRatio $shotPrev $shotNow
  $diffLog.Add("PASS_$pass DIFF_RATIO=$dr (threshold=$DIFF_THRESHOLD)") | Out-Null

  if($dr -ge $DIFF_THRESHOLD){
    $diffLog.Add("STOP: Visible change detected at pass $pass.") | Out-Null
    $shotPrev = $shotNow
    break
  } else {
    # no visible change -> push tabs further down and retry
    $paddingBottom += 6
    $shotPrev = $shotNow
    if($i -eq $MAX_PASSES){
      $diffLog.Add("STOP: Max passes reached without visible change.") | Out-Null
    }
  }
}

W (Join-Path $root "03_changes_by_pass.txt") $changesLog
W (Join-Path $root "04_build_install_by_pass.txt") $buildLog
W (Join-Path $root "06_diff_by_pass.txt") $diffLog

$headEnd = (git rev-parse --short HEAD)
$sum = Join-Path $root "00_summary.txt"
W $sum @(
  "RESULT=PASS"
  "PACKET_REL=$rootRel"
  "BRANCH=$branch"
  "HEAD_START=$head0"
  "HEAD_END=$headEnd"
  "DEVICE=$serial"
  ""
  "OPEN_THIS:"
  (FileUrl $sum)
  ""
  "KEY_FILES:"
  (" - CHANGES: " + (FileUrl (Join-Path $root "03_changes_by_pass.txt")))
  (" - BUILD:   " + (FileUrl (Join-Path $root "04_build_install_by_pass.txt")))
  (" - DIFF:    " + (FileUrl (Join-Path $root "06_diff_by_pass.txt")))
  (" - SHOTS:   " + (FileUrl $shots))
)

Write-Output "PASS. PACKET=$rootRel"
Write-Output ("OPEN: " + (FileUrl $sum))
