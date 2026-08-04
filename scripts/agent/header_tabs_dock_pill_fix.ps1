# ==============================================================
# HEADER_TABS_DOCK_AND_PILL_FIX_V1
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
function W([string]$path,[string[]]$lines){ WriteNoBom $path ($lines -join "`r`n"); $path }

function Snap([string]$baDir,[string]$fileRel,[string]$before,[string]$after){
  $safe = ($fileRel -replace '[\\/:*?"<>| ]','_')
  WriteNoBom (Join-Path $baDir ("before_" + $safe + ".txt")) $before
  WriteNoBom (Join-Path $baDir ("after_"  + $safe + ".txt")) $after
}

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

$ts = NowTs
$rootRel = "diagnostics\ui\HEADER_TABS_DOCK_PILL_FIX_$ts"
$root = Join-Path (Get-Location).Path $rootRel
$ba = Join-Path $root "before_after"
New-Item -ItemType Directory -Force -Path $root,$ba | Out-Null

$branch = (git rev-parse --abbrev-ref HEAD)
$head0  = (git rev-parse --short HEAD)
W (Join-Path $root "01_repo.txt") @("BRANCH=$branch","HEAD_BEFORE=$head0")
W (Join-Path $root "02_status_before.txt") @((git status --porcelain))

# Gate: clean tree
$dirty = (git status --porcelain)
if($dirty.Length -ne 0){
  W (Join-Path $root "99_FAIL_DIRTY_TREE.txt") $dirty
  throw "DIRTY_TREE: commit/stash first. See $rootRel\99_FAIL_DIRTY_TREE.txt"
}

# Gate: JSX corruption scan
$jsxTargets = Get-ChildItem -Recurse -File src -Include *.js,*.jsx,*.ts,*.tsx |
  Where-Object { $_.FullName -notmatch '\\node_modules\\|\\android\\|\\ios\\|\\dist\\|\\build\\|\\coverage\\' }
$bad = Select-String -Path ($jsxTargets.FullName) -Pattern "<Viewstyle|<Viewclass|<Textstyle|<ScrollViewstyle|<SafeAreaViewstyle" -ErrorAction SilentlyContinue
if($bad){
  $lines = @("RESULT=FAIL","BROKEN_TAGS_FOUND=" + $bad.Count) + ($bad | Select-Object -First 200 | ForEach-Object {
    "{0}:{1} :: {2}" -f (Rel $_.Path), $_.LineNumber, $_.Line.Trim()
  })
  W (Join-Path $root "03_FAIL_BROKEN_JSX.txt") $lines
  throw "BROKEN_JSX: Fix first. See $rootRel\03_FAIL_BROKEN_JSX.txt"
}
W (Join-Path $root "03_jsx_ok.txt") @("RESULT=PASS","NO_BROKEN_TAGS_FOUND")

$changes = New-Object System.Collections.Generic.List[string]

# --------------------------------------------------------------
# A) HeaderMenuTabs.tsx - pill geometry + centering
# --------------------------------------------------------------
$tabs = "src\components\HeaderMenuTabs.tsx"
if(-not (Test-Path $tabs)){ throw "MISSING: $tabs" }
$tabsAbs = (Resolve-Path $tabs).Path
$t0 = ReadText $tabsAbs
$t1 = $t0

# tabSelector: keep row, fix wrong-axis centering
$t1 = ForcePropInsideStyle $t1 "tabSelector" "flexDirection" "'row',"
$t1 = ForcePropInsideStyle $t1 "tabSelector" "justifyContent" "'space-between',"
$t1 = ForcePropInsideStyle $t1 "tabSelector" "alignItems" "'stretch',"
$t1 = ForcePropInsideStyle $t1 "tabSelector" "padding" "4,"
$t1 = ForcePropInsideStyle $t1 "tabSelector" "height" "36,"

# tab: deterministic vertical centering
$t1 = ForcePropInsideStyle $t1 "tab" "height" "36,"
$t1 = ForcePropInsideStyle $t1 "tab" "justifyContent" "'center',"
$t1 = ForcePropInsideStyle $t1 "tab" "alignItems" "'center',"
$t1 = ForcePropInsideStyle $t1 "tab" "paddingVertical" "0,"

# tabText baseline stabilization (Android)
$t1 = ForcePropInsideStyle $t1 "tabText" "includeFontPadding" "false,"
$t1 = ForcePropInsideStyle $t1 "tabText" "textAlignVertical" "'center',"
$t1 = ForcePropInsideStyle $t1 "tabText" "lineHeight" "20,"

# Pill indicator: match insets to padding=4.
# NOTE: only top/bottom. left/right are set dynamically via inline style
# (indicatorLeft / indicatorWidth as percentages) and must NOT be overridden.
foreach($k in @("tabIndicator","indicator","pill","activePill","activeIndicator")){
  $t1 = ForcePropInsideStyle $t1 $k "top" "4,"
  $t1 = ForcePropInsideStyle $t1 $k "bottom" "4,"
}

if($t1 -ne $t0){
  Snap $ba (Rel $tabsAbs) $t0 $t1
  WriteNoBom $tabsAbs $t1
  $changes.Add("PATCHED :: " + (Rel $tabsAbs)) | Out-Null
} else {
  $changes.Add("NOCHANGE :: " + (Rel $tabsAbs) + " (style keys may differ)") | Out-Null
}

# --------------------------------------------------------------
# B) BlypHeaderFlow.js - dock tabs to header bottom
# --------------------------------------------------------------
$flow = "src\components\BlypHeaderFlow.js"
if(-not (Test-Path $flow)){ throw "MISSING: $flow" }
$flowAbs = (Resolve-Path $flow).Path
$f0 = ReadText $flowAbs
$f1 = $f0

# tabsDock should already exist; ensure marginTop:'auto' + paddingBottom
$f1 = ForcePropInsideStyle $f1 "tabsDock" "marginTop" "'auto',"
$f1 = ForcePropInsideStyle $f1 "tabsDock" "paddingBottom" "8,"

if($f1 -ne $f0){
  Snap $ba (Rel $flowAbs) $f0 $f1
  WriteNoBom $flowAbs $f1
  $changes.Add("PATCHED :: " + (Rel $flowAbs)) | Out-Null
} else {
  $changes.Add("NOCHANGE :: " + (Rel $flowAbs) + " (already docked/wrapped)") | Out-Null
}

# --------------------------------------------------------------
# Proof
# --------------------------------------------------------------
$proof = New-Object System.Collections.Generic.List[string]
$proof.Add("TARGETS:") | Out-Null
$proof.Add(" - $tabs") | Out-Null
$proof.Add(" - $flow") | Out-Null
$proof.Add("") | Out-Null

$targets = @($tabs,$flow)
function Hit($label,$pat){
  $script:proof.Add("=== $label ===") | Out-Null
  $hits = Select-String -Path $targets -Pattern $pat -ErrorAction SilentlyContinue
  if($hits){
    foreach($h in $hits){ $script:proof.Add(("{0}:{1} :: {2}" -f (Rel $h.Path), $h.LineNumber, $h.Line.Trim())) | Out-Null }
  } else { $script:proof.Add("NO_HITS") | Out-Null }
  $script:proof.Add("") | Out-Null
}

Hit "tabSelector layout" "tabSelector|justifyContent|alignItems|padding:\s*4|height:\s*36"
Hit "indicator insets" "top:\s*4|bottom:\s*4"
Hit "tabsDock present" "tabsDock|marginTop|paddingBottom"

W (Join-Path $root "09_changes.txt") ($changes | Sort-Object)
W (Join-Path $root "10_proof_scan.txt") $proof

# Commit if changed
$didPatch = ($changes | Where-Object { $_ -like "PATCHED*" }).Count -gt 0
if($didPatch){
  git add $tabs $flow | Out-Null
  git commit -m "style(ui): dock header tabs + fix pill geometry" | Out-Null
}

$head1 = (git rev-parse --short HEAD)
$sum = Join-Path $root "00_summary.txt"
W $sum @(
  "RESULT=PASS"
  "PACKET_REL=$rootRel"
  "BRANCH=$branch"
  "HEAD_BEFORE=$head0"
  "HEAD_AFTER=$head1"
  "COMMITTED=$didPatch"
  ""
  "OPEN_THIS:"
  (FileUrl $sum)
  ""
  "EVIDENCE:"
  (" - CHANGES: " + (FileUrl (Join-Path $root "09_changes.txt")))
  (" - PROOF:   " + (FileUrl (Join-Path $root "10_proof_scan.txt")))
  (" - DIFFS:   " + (FileUrl $ba))
)

Write-Output "PASS. PACKET=$rootRel"
Write-Output ("OPEN: " + (FileUrl $sum))
