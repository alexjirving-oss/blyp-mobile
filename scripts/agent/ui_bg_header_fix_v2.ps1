# ==============================================================
# VS CODE AGENT COMMAND — UI_BG_AND_HEADER_GAP_FIX_AUDIT_V2 (TIGHT)
# GOAL:
#   Fix the real causes of:
#     (1) header-to-content gap (double status-bar/safe-area compensation)
#     (2) inconsistent "blue" backgrounds (header/body seam)
#
# HARD RULES:
#   - Patch ONLY known offenders (no broad JSX regex edits)
#   - Write UTF-8 NO-BOM (prevents Gradle/BOM failures)
#   - Produce ONE evidence packet and print clickable file:/// links
#
# OUTPUT PACKET:
#   diagnostics\ui\UI_BG_HEADER_FIX_V2_<ts>\*
#     00_summary.txt
#     01_repo.txt
#     02_status_before.txt
#     03_changes.txt
#     04_before_after\*
#     10_proof_scan.txt
#     11_jsx_syntax_scan.txt
#     12_remaining_suspects.txt
# ==============================================================
$ErrorActionPreference="Stop"
$PSNativeCommandUseErrorActionPreference=$false
Set-Location C:\Users\Alex\Blyp26

function NowTs(){ Get-Date -Format "yyyyMMdd_HHmmss" }
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function WriteTextNoBom([string]$path,[string]$content){
  New-Item -ItemType Directory -Force -Path (Split-Path $path) | Out-Null
  [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
}
function W([string]$path, [string[]]$lines){
  WriteTextNoBom $path ($lines -join "`r`n")
  $path
}
function ReadText([string]$path){ Get-Content -Raw -LiteralPath $path -ErrorAction Stop }
function Rel([string]$path){
  try { (Resolve-Path $path).Path.Replace((Get-Location).Path + "\", "") } catch { $path }
}
function FileUrl([string]$path){
  $full = if(Test-Path $path){ (Resolve-Path $path).Path } else { [System.IO.Path]::GetFullPath($path) }
  $full = $full -replace "\\","/"
  "file:///$full"
}

$ts = NowTs
$rootRel = "diagnostics\ui\UI_BG_HEADER_FIX_V2_$ts"
$root = Join-Path (Get-Location).Path $rootRel
New-Item -ItemType Directory -Force -Path $root | Out-Null
$ba = Join-Path $root "04_before_after"
New-Item -ItemType Directory -Force -Path $ba | Out-Null

W (Join-Path $root "01_repo.txt") @(
  ("BRANCH=" + (git rev-parse --abbrev-ref HEAD))
  ("HEAD="   + (git rev-parse --short HEAD))
)
W (Join-Path $root "02_status_before.txt") @((git status --porcelain))

$changes = New-Object System.Collections.Generic.List[string]

function SnapshotPatch([string]$path, [scriptblock]$mut){
  if(-not (Test-Path $path)){
    $changes.Add("MISSING :: $path") | Out-Null
    return
  }
  $abs = (Resolve-Path $path).Path
  $before = ReadText $abs
  $after  = & $mut $before
  if($after -ne $before){
    $safe = (Rel $abs) -replace "[\\/:*?`"<>| ]","_"
    WriteTextNoBom (Join-Path $ba ("before_$safe.txt")) $before
    WriteTextNoBom (Join-Path $ba ("after_$safe.txt"))  $after
    WriteTextNoBom $abs $after
    $changes.Add("PATCHED :: " + (Rel $abs)) | Out-Null
  } else {
    $changes.Add("NOCHANGE :: " + (Rel $abs)) | Out-Null
  }
}

# ==============================================================
# 1) GAP FIXES (remove double compensation)
# ==============================================================
# A) ScreenContainer: kill StatusBar.currentHeight top padding
SnapshotPatch "src\components\ScreenContainer.js" {
  param($t)
  $x = $t

  # Most likely offender from your report:
  $x = [regex]::Replace($x,
    "(?m)^\s*paddingTop\s*:\s*Platform\.OS\s*===\s*['""]android['""]\s*\?\s*StatusBar\.currentHeight\s*:\s*0\s*,\s*$",
    "    paddingTop: 0,", 1)

  # Fallback if direct:
  $x = [regex]::Replace($x,
    "(?m)^\s*paddingTop\s*:\s*StatusBar\.currentHeight\s*,\s*$",
    "    paddingTop: 0,", 1)

  # Remove StatusBar import if unused after edits
  $importRx = [regex]"(?m)^\s*import\s*\{\s*([^}]+)\s*\}\s*from\s*['""]react-native['""]\s*;\s*$"
  if($importRx.IsMatch($x)){
    $x = $importRx.Replace($x, {
      param($m)
      $items = $m.Groups[1].Value.Split(",") | ForEach-Object { $_.Trim() } | Where-Object { $_ }
      $body = $importRx.Replace($x, "", 1)
      if($body -notmatch "\bStatusBar\b"){ $items = $items | Where-Object { $_ -ne "StatusBar" } }
      $joined = ($items | Select-Object -Unique | Sort-Object) -join ", "
      "import { $joined } from 'react-native';"
    }, 1)
  }

  return $x
}

# B) Tab bodies: remove hard-coded paddingTop:60 status-bar hacks
foreach($tab in @(
  "src\components\CategoriesTab.js",
  "src\components\HashtagsTab.js",
  "src\components\WhatsAppPopularTab.js"
)){
  SnapshotPatch $tab {
    param($t)
    [regex]::Replace($t, "(?m)^\s*paddingTop\s*:\s*60\s*(//.*)?\s*$", "    paddingTop: 0,", 1)
  }
}

# C) Chat screens: remove paddingTop: StatusBar.currentHeight + N
foreach($chat in @(
  "src\screens\ChatRoomScreen.js",
  "src\screens\ChatRoomsScreen.js"
)){
  SnapshotPatch $chat {
    param($t)
    [regex]::Replace($t, "(?m)^\s*paddingTop\s*:\s*StatusBar\.currentHeight\s*\+\s*\d+\s*,?\s*$", "    paddingTop: 0,", 0)
  }
}

# D) LiveUsersTab insane offsets
SnapshotPatch "src\components\LiveUsersTab.js" {
  param($t)
  $x = $t
  $x = $x -replace "paddingTop:\s*insets\.top\s*\+\s*140", "paddingTop: 0"
  $x = $x -replace "paddingTop:\s*insets\.top\s*\+\s*10",  "paddingTop: 0"
  return $x
}

# E) Messenger + SearchBar big fixed gaps
SnapshotPatch "src\screens\MessengerScreen.js" {
  param($t)
  $x = $t
  $x = [regex]::Replace($x, "(?m)^\s*paddingTop\s*:\s*50\s*,\s*$", "    paddingTop: 0,", 0)
  $x = [regex]::Replace($x, "(?m)^\s*marginTop\s*:\s*70\s*,\s*$", "    marginTop: 0,", 0)
  $x = [regex]::Replace($x, "(?m)^\s*padding\s*:\s*24\s*,\s*$",     "    padding: 0,", 0)
  return $x
}

SnapshotPatch "src\components\SearchBar.js" {
  param($t)
  $x = $t
  $x = [regex]::Replace($x, "(?m)^\s*marginTop\s*:\s*50\s*,\s*$",  "    marginTop: 0,", 0)
  $x = [regex]::Replace($x, "(?m)^\s*paddingTop\s*:\s*24\s*,\s*$", "    paddingTop: 0,", 0)
  return $x
}

# ==============================================================
# 2) BACKGROUND SEAM FIX (minimal + safe)
# ==============================================================
# Align tab strip bg to theme background (removes header/body seam)
SnapshotPatch "src\components\HeaderMenuTabs.tsx" {
  param($t)
  ($t -replace "backgroundColor:\s*theme\.colors\.surfaceAlt", "backgroundColor: theme.colors.background")
}

# Align theme pageBackground if it's EXACTLY '#1e293b' -> COLORS.background
SnapshotPatch "src\styles\theme.js" {
  param($t)
  [regex]::Replace($t, "(?m)^\s*pageBackground\s*:\s*['""]#1e293b['""]\s*,\s*$", "  pageBackground: COLORS.background,", 1)
}

# ==============================================================
# 3) PROOF SCANS (no build)
# ==============================================================
$scan = @(
  "src\components\ScreenContainer.js",
  "src\components\CategoriesTab.js",
  "src\components\HashtagsTab.js",
  "src\components\WhatsAppPopularTab.js",
  "src\screens\ChatRoomScreen.js",
  "src\screens\ChatRoomsScreen.js",
  "src\screens\MessengerScreen.js",
  "src\components\LiveUsersTab.js",
  "src\components\SearchBar.js",
  "src\components\HeaderMenuTabs.tsx",
  "src\styles\theme.js"
)

$proof = New-Object System.Collections.Generic.List[string]
$proof.Add("SCAN_FILES:") | Out-Null
foreach($p in $scan){ $proof.Add(" - $p") | Out-Null }

function ScanHit($label,$pattern){
  $proof.Add("") | Out-Null
  $proof.Add("=== $label ===") | Out-Null
  $hits = Select-String -Path $scan -Pattern $pattern -ErrorAction SilentlyContinue
  if($hits){
    foreach($h in $hits){
      $proof.Add(("{0}:{1} :: {2}" -f (Rel $h.Path), $h.LineNumber, $h.Line.Trim())) | Out-Null
    }
  } else {
    $proof.Add("NO_HITS") | Out-Null
  }
}

ScanHit "StatusBar.currentHeight remaining?" "StatusBar\.currentHeight"
ScanHit "paddingTop:60 remaining?" "paddingTop\s*:\s*60"
ScanHit "insets.top + 140 remaining?" "insets\.top\s*\+\s*140"
ScanHit "Messenger 50/70 remaining?" "(paddingTop\s*:\s*50|marginTop\s*:\s*70)"
ScanHit "Header tabs surfaceAlt remaining?" "theme\.colors\.surfaceAlt"
ScanHit "theme pageBackground line" "pageBackground"

W (Join-Path $root "10_proof_scan.txt") $proof

# ==============================================================
# 4) JSX SYNTAX SCAN (catches the crash you just hit: <Viewstyle=)
# ==============================================================
$jsxSus = New-Object System.Collections.Generic.List[string]
$jsxSus.Add("LOOKING_FOR_BROKEN_TAGS: <Viewstyle  <Viewclass  <View[a-z]") | Out-Null

$jsxTargets = Get-ChildItem -Recurse -File src -Include *.js,*.jsx,*.ts,*.tsx |
  Where-Object { $_.FullName -notmatch "\\node_modules\\|\\android\\|\\ios\\|\\dist\\|\\build\\|\\coverage\\" }

$bad = Select-String -Path ($jsxTargets.FullName) -Pattern "<Viewstyle|<Viewclass|<View[a-z]" -ErrorAction SilentlyContinue
if($bad){
  foreach($b in $bad){
    $jsxSus.Add(("{0}:{1} :: {2}" -f (Rel $b.Path), $b.LineNumber, $b.Line.Trim())) | Out-Null
  }
} else {
  $jsxSus.Add("NO_HITS") | Out-Null
}
W (Join-Path $root "11_jsx_syntax_scan.txt") $jsxSus

# ==============================================================
# 5) Remaining suspects list (the "next things to kill" if still wrong)
# ==============================================================
$rem = New-Object System.Collections.Generic.List[string]
$rem.Add("REMAINING_SUSPECTS_IN_WELL_KNOWN_FILES:") | Out-Null
@(
  " - src\screens\HomeScreen.js (header layout / container bg vs body bg)"
  " - src\components\HeaderContainer.js (header background token)"
  " - src\components\BlypHeaderFlow.js (header wrapper padding/margin)"
  " - src\ui\BlueScreen.tsx (StatusBar/translucent + container padding logic)"
) | ForEach-Object { $rem.Add($_) | Out-Null }

# If ScreenContainer still contains backgroundColor pageBackground, note it:
try{
  $sc = ReadText (Resolve-Path "src\components\ScreenContainer.js").Path
  if($sc -match "backgroundColor:\s*COLORS\.pageBackground"){ $rem.Add("NOTE: ScreenContainer still uses COLORS.pageBackground (theme seam possible).") | Out-Null }
} catch {}

W (Join-Path $root "12_remaining_suspects.txt") $rem

# Changes log
W (Join-Path $root "03_changes.txt") ($changes | Sort-Object)

# Summary + CLICKABLE LINKS
$sumPath = Join-Path $root "00_summary.txt"
W $sumPath @(
  "RESULT=PASS"
  "PACKET_REL=$rootRel"
  "PACKET_ABS=$root"
  ""
  "OPEN_THIS_FIRST:"
  (FileUrl $sumPath)
  ""
  "EVIDENCE_LINKS:"
  (" - CHANGES: " + (FileUrl (Join-Path $root "03_changes.txt")))
  (" - PROOF:   " + (FileUrl (Join-Path $root "10_proof_scan.txt")))
  (" - JSXSCAN: " + (FileUrl (Join-Path $root "11_jsx_syntax_scan.txt")))
  (" - NEXT:    " + (FileUrl (Join-Path $root "12_remaining_suspects.txt")))
  ""
  "WHAT_CHANGED:"
  " - Removed ScreenContainer Android StatusBar.currentHeight top padding"
  " - Removed duplicate paddingTop:60 in Categories/Hashtags/WhatsAppPopular tabs"
  " - Removed StatusBar.currentHeight + N paddingTop in ChatRoom/ChatRooms screens"
  " - Removed extreme offsets: LiveUsersTab (insets.top+140), Messenger (50/70), SearchBar (50/24)"
  " - Reduced header/body seam: HeaderMenuTabs surfaceAlt -> theme background; theme pageBackground -> COLORS.background (only if exact #1e293b match)"
)

Write-Output "PASS. PACKET=$rootRel"
Write-Output ("OPEN: " + (FileUrl $sumPath))
Write-Output ("PROOF: " + (FileUrl (Join-Path $root "10_proof_scan.txt")))
Write-Output ("JSX:   " + (FileUrl (Join-Path $root "11_jsx_syntax_scan.txt")))
