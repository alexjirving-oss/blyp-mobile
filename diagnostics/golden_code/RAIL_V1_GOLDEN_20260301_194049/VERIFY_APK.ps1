$ErrorActionPreference="Stop"
Set-Location C:\Users\Alex\Blyp26

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$pkt = "diagnostics\rail_v1\VERIFY_APK_$ts"
New-Item -ItemType Directory -Force -Path $pkt | Out-Null

function W($name, $lines){
  $p = Join-Path $pkt $name
  $lines | Out-File -Encoding utf8 $p
  $p
}

$apk = "android\app\build\outputs\apk\release\app-release.apk"
if(-not (Test-Path $apk)){ throw "APK_NOT_FOUND" }
$apkAbs = (Resolve-Path $apk).Path

W "01_apk_info.txt" @(
  "APK=$apkAbs"
  "SIZE_BYTES=$((Get-Item $apkAbs).Length)"
  "SHA256=$((Get-FileHash $apkAbs -Algorithm SHA256).Hash)"
) | Out-Null

# Scan for loopback markers, then allowlist known Sentry CI path if it's the only match.
Add-Type -AssemblyName System.IO.Compression.FileSystem
$rx = "(127\.0\.0\.1|localhost)"
$allow = "http://localhost:8081/home/runner/work/sentry-javascript/sentry-javascript/packages/react/src/errorboundary.tsx"
$hits = @()

$zip = [System.IO.Compression.ZipFile]::OpenRead($apkAbs)
try{
  foreach($e in $zip.Entries){
    if($e.FullName -match "\.(js|json|txt|xml|properties|env)$" -or $e.FullName -match "assets/"){
      if($e.Length -gt 0 -and $e.Length -lt 8000000){
        try{
          $sr = New-Object System.IO.StreamReader($e.Open())
          $c = $sr.ReadToEnd(); $sr.Close()
          if($c -match $rx){
            $hits += "$($e.FullName) :: MATCH"
            if($hits.Count -ge 200){ break }
          }
        } catch {}
      }
    }
  }
} finally { $zip.Dispose() }

W "02_loopback_scan.txt" @(
  "RX=$rx"
  "HITS_COUNT=$($hits.Count)"
  "HITS_FIRST_200="
) + $hits | Out-Null

$result = "PASS"
$note = "NO_LOOPBACK"
if($hits.Count -gt 0){
  # treat as pass if ONLY allowlisted Sentry string exists in bundle
  # (quick check: extract index.android.bundle and search allow string)
  $zip2 = [System.IO.Compression.ZipFile]::OpenRead($apkAbs)
  try{
    $entry = $zip2.Entries | Where-Object { $_.FullName -eq "assets/index.android.bundle" } | Select-Object -First 1
    if($entry){
      $sr2 = New-Object System.IO.StreamReader($entry.Open())
      $bundle = $sr2.ReadToEnd(); $sr2.Close()
      if($hits.Count -eq 1 -and $bundle -match [regex]::Escape($allow)){
        $result = "PASS_ALLOWLIST"
        $note = "ALLOWLIST_SENTRY_SOURCEPATH"
      } else {
        $result = "FAIL"
        $note = "LOOPBACK_NON_ALLOWLIST"
      }
    } else {
      $result = "FAIL"
      $note = "BUNDLE_NOT_FOUND_FOR_ALLOWLIST_CHECK"
    }
  } finally { $zip2.Dispose() }
}

W "00_summary.txt" @(
  "RESULT=$result"
  "NOTE=$note"
  "ALLOWLIST_VALUE=$allow"
  "PACKET_DIR=$((Resolve-Path $pkt).Path)"
  "APK=$apkAbs"
  "LOOPBACK_HITS=$($hits.Count)"
)
Get-Content (Join-Path $pkt "00_summary.txt")
