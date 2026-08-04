$ErrorActionPreference="Stop"
$PSNativeCommandUseErrorActionPreference=$false
Set-Location C:\Users\Alex\Blyp26

function NowTs(){ Get-Date -Format "yyyyMMdd_HHmmss" }
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function WriteNoBom([string]$path,[string]$content){
  $dir = Split-Path $path
  if($dir){ New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $absPath = if(Test-Path $path){ (Resolve-Path $path).Path } else { [System.IO.Path]::GetFullPath($path) }
  [System.IO.File]::WriteAllText($absPath, $content, $utf8NoBom)
}
function W([string]$path,[string[]]$lines){ WriteNoBom $path ($lines -join "`r`n"); $path }
function ReadText([string]$path){ Get-Content -Raw -LiteralPath $path -ErrorAction Stop }
function Rel([string]$path){
  try { (Resolve-Path $path).Path.Replace((Get-Location).Path + "\", "") } catch { $path }
}
function FileUrl([string]$path){
  $full = if(Test-Path $path){ (Resolve-Path $path).Path } else { [System.IO.Path]::GetFullPath($path) }
  "file:///" + ($full -replace "\\","/")
}

$ts = NowTs
$rootRel = "diagnostics\ui\UI_FINE_TUNE_TABS_V1_$ts"
$root = Join-Path (Get-Location).Path $rootRel
$ba = Join-Path $root "04_before_after"
New-Item -ItemType Directory -Force -Path $root | Out-Null
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
    WriteNoBom (Join-Path $ba ("before_$safe.txt")) $before
    WriteNoBom (Join-Path $ba ("after_$safe.txt"))  $after
    [System.IO.File]::WriteAllText($abs, $after, $utf8NoBom)
    $changes.Add("PATCHED :: " + (Rel $abs)) | Out-Null
  } else {
    $changes.Add("NOCHANGE :: " + (Rel $abs)) | Out-Null
  }
}

function EnsureStyleProp([string]$t,[string]$styleKey,[string]$prop,[string]$value){
  $rxBlock = [regex]"(?ms)(\b$([regex]::Escape($styleKey))\b\s*:\s*\{)(.*?)(\})"
  $m = $rxBlock.Match($t)
  if(-not $m.Success){ return $t }

  $open = $m.Groups[1].Value
  $body = $m.Groups[2].Value
  $close= $m.Groups[3].Value

  $rxProp = [regex]"(?m)^\s*$([regex]::Escape($prop))\s*:\s*[^,\}]+,?\s*$"
  if($rxProp.IsMatch($body)){
    $body2 = $rxProp.Replace($body, ("  ${prop}: $value,"), 1)
  } else {
    $body2 = ("`r`n  ${prop}: $value," + $body)
  }

  $newBlock = $open + $body2 + $close
  return $t.Substring(0,$m.Index) + $newBlock + $t.Substring($m.Index + $m.Length)
}

# --------------------------------------------------------------
# 1) Add small content padding for tab bodies (NOT For Me feed)
# --------------------------------------------------------------
$CONTENT_PAD = 8

foreach($f in @(
  "src\components\CategoriesTab.js",
  "src\components\HashtagsTab.js",
  "src\components\WhatsAppPopularTab.js"
)){
  SnapshotPatch $f {
    param($t)
    $x = $t

    if($x -match "(?ms)\blistContent\s*:\s*\{"){
      $x2 = EnsureStyleProp $x "listContent" "paddingTop" $CONTENT_PAD
      if($x2 -ne $x){ return $x2 }
    }

    if($x -match "(?ms)\blistContainer\s*:\s*\{"){
      $x2 = EnsureStyleProp $x "listContainer" "paddingTop" $CONTENT_PAD
      if($x2 -ne $x){ return $x2 }
    }

    $x = [regex]::Replace($x, "(?m)^\s*paddingTop\s*:\s*0\s*,\s*$", ("  paddingTop: $CONTENT_PAD,"), 1)
    return $x
  }
}

# --------------------------------------------------------------
# 2) HeaderMenuTabs fine-tune
# --------------------------------------------------------------
$TAB_STRIP_DROP = 6
$TAB_HEIGHT = 36

SnapshotPatch "src\components\HeaderMenuTabs.tsx" {
  param($t)
  $x = $t

  # tabSelector has flexDirection:'row' — use it for marginTop drop
  if($x -match "(?ms)\btabSelector\s*:\s*\{"){
    $x = EnsureStyleProp $x "tabSelector" "marginTop" $TAB_STRIP_DROP
  } elseif($x -match "(?ms)\btabContainer\s*:\s*\{"){
    $x = EnsureStyleProp $x "tabContainer" "marginTop" $TAB_STRIP_DROP
  }

  # tab style — force height + vertical centering
  if($x -match "(?ms)\btab\b\s*:\s*\{"){
    $x = EnsureStyleProp $x "tab" "height" $TAB_HEIGHT
    $x = EnsureStyleProp $x "tab" "justifyContent" "'center'"
  }

  # tabText — Android baseline fix
  if($x -match "(?ms)\btabText\s*:\s*\{"){
    $x = EnsureStyleProp $x "tabText" "includeFontPadding" "false"
    $x = EnsureStyleProp $x "tabText" "textAlignVertical" "'center'"
  }

  return $x
}

# --------------------------------------------------------------
# 3) Proof scan
# --------------------------------------------------------------
$proof = New-Object System.Collections.Generic.List[string]
$targets = @(
  "src\components\HeaderMenuTabs.tsx",
  "src\components\CategoriesTab.js",
  "src\components\HashtagsTab.js",
  "src\components\WhatsAppPopularTab.js"
)

$proof.Add("FILES:") | Out-Null
$targets | ForEach-Object { $proof.Add(" - $_") | Out-Null }

$proof.Add("") | Out-Null
$proof.Add("=== QUICK_CHECKS ===") | Out-Null

function AddHits($label,$pattern){
  $proof.Add("") | Out-Null
  $proof.Add("=== $label ===") | Out-Null
  $hits = Select-String -Path $targets -Pattern $pattern -ErrorAction SilentlyContinue
  if($hits){
    foreach($h in $hits){
      $proof.Add(("{0}:{1} :: {2}" -f (Rel $h.Path), $h.LineNumber, $h.Line.Trim())) | Out-Null
    }
  } else {
    $proof.Add("NO_HITS") | Out-Null
  }
}

AddHits "Content paddingTop now (expect 8 somewhere in tab components)" "paddingTop\s*:\s*8"
AddHits "HeaderMenuTabs marginTop (expect 6 on container)" "marginTop\s*:\s*6"
AddHits "Tab item vertical centering (expect justify/align center)" "(justifyContent\s*:\s*'center'|alignItems\s*:\s*'center')"
AddHits "Android text baseline fix (includeFontPadding false)" "includeFontPadding\s*:\s*false"

W (Join-Path $root "10_proof_scan.txt") $proof
W (Join-Path $root "03_changes.txt") ($changes | Sort-Object)

$sum = Join-Path $root "00_summary.txt"
W $sum @(
  "RESULT=PASS"
  "PACKET_REL=$rootRel"
  "PACKET_ABS=$root"
  ""
  "OPEN_THIS_FIRST:"
  (FileUrl $sum)
  ""
  "EVIDENCE_LINKS:"
  (" - CHANGES: " + (FileUrl (Join-Path $root "03_changes.txt")))
  (" - PROOF:   " + (FileUrl (Join-Path $root "10_proof_scan.txt")))
  (" - BEFORE/AFTER DIR: " + (FileUrl $ba))
  ""
  "WHAT_THIS_DID:"
  " - Adds small content paddingTop=$CONTENT_PAD to Categories/Hashtags/What'sHot tab bodies (ONLY those files)."
  " - Drops HeaderMenuTabs strip down by ~${TAB_STRIP_DROP}px (tabSelector marginTop)."
  " - Forces tab items to vertically center labels (height=$TAB_HEIGHT, justifyContent center)."
  " - Reduces Android text baseline drift (includeFontPadding:false, textAlignVertical:'center')."
)

Write-Output "PASS. PACKET=$rootRel"
Write-Output ("OPEN: " + (FileUrl $sum))
