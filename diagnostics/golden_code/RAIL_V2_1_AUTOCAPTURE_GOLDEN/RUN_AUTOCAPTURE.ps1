param(
  [int]$Seconds = 60,
  [switch]$NoInstall,
  [switch]$SkipBugreport = $false,
  [int]$BugreportTimeoutSec = 240
)

# Use Continue so adb stderr doesn't become a terminating error in PS 5.1
$ErrorActionPreference="Continue"
Set-Location C:\Users\Alex\Blyp26

function EnsureDir($p){ if(-not (Test-Path $p)){ New-Item -ItemType Directory -Force -Path $p | Out-Null } }
function W($dir, $name, $lines){
  $p = Join-Path $dir $name
  $lines | Out-File -Encoding utf8 $p
  $p
}

# 0) Run packet dir
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$pkt = "diagnostics\rail_v2\AUTOCAPTURE_$ts"
EnsureDir $pkt

# 1) APK
$apk = "android\app\build\outputs\apk\release\app-release.apk"
if(-not (Test-Path $apk)){ throw "APK_NOT_FOUND: $apk" }
$apkAbs = (Resolve-Path $apk).Path

W $pkt "00_apk_info.txt" @(
  "APK=$apkAbs"
  "SIZE_BYTES=$((Get-Item $apkAbs).Length)"
  "SHA256=$((Get-FileHash $apkAbs -Algorithm SHA256).Hash)"
) | Out-Null

# 2) Devices
$raw = adb devices -l
W $pkt "01_adb_devices.txt" (@("=== adb devices -l ===") + $raw) | Out-Null

$lines = ($raw | Select-Object -Skip 1) | Where-Object { $_ -match "\S" }
$devs = @()
foreach($l in $lines){
  $p = $l -split "\s+"
  if($p.Length -ge 2 -and $p[1] -eq "device"){ $devs += $p[0] }
}
if($devs.Count -eq 0){ throw "NO_AUTHORIZED_DEVICES" }

$pkg = "com.blyp.mobile"

$summary = @(
  "PKT=$((Resolve-Path $pkt).Path)"
  "APK=$apkAbs"
  "DEVICES_COUNT=$($devs.Count)"
  "DEVICES=$($devs -join ',')"
  "SECONDS=$Seconds"
  "NO_INSTALL=$NoInstall"
  ""
)

foreach($d in $devs){
  $dDir = Join-Path $pkt $d
  EnsureDir $dDir

  # Identity
  $props = @()
  $props += "SERIAL=$d"
  $props += "MODEL=$(adb -s $d shell getprop ro.product.model 2>$null)"
  $props += "MANUFACTURER=$(adb -s $d shell getprop ro.product.manufacturer 2>$null)"
  $props += "SDK=$(adb -s $d shell getprop ro.build.version.sdk 2>$null)"
  $props += "RELEASE=$(adb -s $d shell getprop ro.build.version.release 2>$null)"
  $props += "FINGERPRINT=$(adb -s $d shell getprop ro.build.fingerprint 2>$null)"
  W $dDir "10_device_props.txt" $props | Out-Null

  # Install optional
  if(-not $NoInstall){
    $inst = @()
    $inst += "=== UNINSTALL (ignore errors) ==="
    $inst += (adb -s $d uninstall $pkg 2>&1)
    $inst += "=== INSTALL ==="
    $inst += (adb -s $d install -r -d $apkAbs 2>&1)
    W $dDir "20_install.txt" $inst | Out-Null
  } else {
    W $dDir "20_install.txt" @("SKIP_INSTALL=True") | Out-Null
  }

  # Launch
  $launch = @()
  $launch += "=== FORCE_STOP ==="
  $launch += (adb -s $d shell am force-stop $pkg 2>&1)
  $launch += "=== LAUNCH (monkey) ==="
  $launch += (adb -s $d shell monkey -p $pkg -c android.intent.category.LAUNCHER 1 2>&1)
  W $dDir "30_launch.txt" $launch | Out-Null

  Start-Sleep -Milliseconds 800

  # PID (retry + fallback)
  $appPid = ""
  for($i=0; $i -lt 10 -and -not $appPid; $i++){
    $appPid = (adb -s $d shell pidof $pkg 2>$null).Trim()
    if(-not $appPid){
      $appPid = (adb -s $d shell "ps -A | grep $pkg" 2>$null | ForEach-Object {
        ($_ -split "\s+")[1]
      } | Select-Object -First 1)
      if($appPid){ $appPid = $appPid.Trim() }
    }
    if(-not $appPid){ Start-Sleep -Milliseconds 500 }
  }
  W $dDir "31_pid.txt" @("PID=$appPid") | Out-Null

  # Version proof
  $ver = adb -s $d shell dumpsys package $pkg 2>&1 |
    Select-String -Pattern "versionCode=|versionName=" | ForEach-Object { $_.Line.Trim() }
  W $dDir "32_version.txt" $ver | Out-Null

  # Clear buffer then capture logcat
  adb -s $d logcat -c 2>$null | Out-Null

  $logPath = Join-Path $dDir "40_logcat.txt"
  if($appPid){
    $pLog = Start-Process -FilePath "adb" -ArgumentList @("-s",$d,"logcat","--pid=$appPid","-v","threadtime") -NoNewWindow -PassThru `
      -RedirectStandardOutput $logPath -RedirectStandardError (Join-Path $dDir "40_logcat_err.txt")
  } else {
    $pLog = Start-Process -FilePath "adb" -ArgumentList @("-s",$d,"logcat","-v","threadtime") -NoNewWindow -PassThru `
      -RedirectStandardOutput $logPath -RedirectStandardError (Join-Path $dDir "40_logcat_err.txt")
  }

  Start-Sleep -Seconds $Seconds
  try { Stop-Process -Id $pLog.Id -Force -ErrorAction SilentlyContinue } catch {}

  # Crash/ANR evidence
  $pull = @()
  $pull += "=== TOMBSTONES LIST (tail 50) ==="
  $pull += (adb -s $d shell "ls -la /data/tombstones 2>/dev/null | tail -n 50" 2>&1)
  $pull += ""
  $pull += "=== DROPBOX (tail 200) ==="
  $pull += (adb -s $d shell "dumpsys dropbox | tail -n 200" 2>&1)
  W $dDir "50_crash_anr_evidence.txt" $pull | Out-Null

  # Bugreport (non-fatal; supports skip + timeout)
  if($SkipBugreport){
    W $dDir "61_bugreport_status.txt" @("BUGREPORT=SKIPPED") | Out-Null
  } else {
    $zipOut = Join-Path (Resolve-Path $dDir).Path "60_bugreport.zip"
    $brStatus = "BUGREPORT=UNKNOWN"
    try {
      $job = Start-Job -ScriptBlock {
        param($serial, $zipPath)
        adb -s $serial bugreport $zipPath 2>&1 | Out-Null
      } -ArgumentList $d, $zipOut

      if(Wait-Job $job -Timeout $BugreportTimeoutSec){
        Receive-Job $job | Out-Null
        $brStatus = if(Test-Path $zipOut){"BUGREPORT=OK"} else {"BUGREPORT=NO_FILE"}
      } else {
        Stop-Job $job -Force | Out-Null
        $brStatus = "BUGREPORT=TIMEOUT"
      }
      Remove-Job $job -Force | Out-Null
    } catch {
      $brStatus = "BUGREPORT=ERROR: $($_.Exception.Message)"
    }
    W $dDir "61_bugreport_status.txt" @($brStatus) | Out-Null
  }

  $summary += "DEVICE=$d PID=$appPid LOG=$logPath"
}

W $pkt "99_summary.txt" $summary | Out-Null

# --- V2_2_VERDICT_BLOCK ---
# Post-run: crash detection + excerpts + JSON verdict

function Write-VerdictJson($path, $obj){
  $obj | ConvertTo-Json -Depth 8 | Out-File -Encoding utf8 $path
}

# Detection patterns
$rxFatal = '(?i)FATAL EXCEPTION'
$rxAnr   = '(?i)\bANR in\b'
$rxDied  = '(?i)Process\s+com\.blyp\.mobile\s+has\s+died'
$rxJava  = '(?i)AndroidRuntime: FATAL EXCEPTION|java\.lang\.|kotlin\.'
$rxRnRed = '(?i)ReactNativeJS:.*(error|exception)'

$findings = @()
$excerpts = @()

foreach($d in $devs){
  $dDir = Join-Path $pkt $d
  $log  = Join-Path $dDir "40_logcat.txt"
  if(-not (Test-Path $log)){ continue }

  $txt = Get-Content $log -Raw

  $hits = @()
  if([regex]::IsMatch($txt, $rxFatal)){ $hits += "FATAL_EXCEPTION" }
  if([regex]::IsMatch($txt, $rxAnr)){   $hits += "ANR" }
  if([regex]::IsMatch($txt, $rxDied)){  $hits += "PROCESS_DIED" }

  if($hits.Count -gt 0){
    $findings += [pscustomobject]@{ device=$d; hits=$hits }
  }

  # Excerpt: last 120 lines around strongest signals
  $logLines = Get-Content $log
  $sig = @()
  foreach($idx in 0..($logLines.Count-1)){
    $ln = $logLines[$idx]
    if($ln -match $rxFatal -or $ln -match $rxAnr -or $ln -match $rxDied -or $ln -match $rxJava){
      $sig += $idx
    }
  }
  if($sig.Count -gt 0){
    $pick  = $sig[-1]
    $start = [Math]::Max(0, $pick - 80)
    $end   = [Math]::Min($logLines.Count-1, $pick + 40)
    $chunk = $logLines[$start..$end]
    $excerpts += [pscustomobject]@{ device=$d; startLine=$start; endLine=$end; excerpt=($chunk -join "`n") }
  }
}

$result = if($findings.Count -gt 0){"FAIL"} else {"PASS"}

# 98_crash_detection.txt
$detection = @("AUTO_DETECTION=$result")
if($findings.Count -gt 0){
  foreach($f in $findings){
    $detection += "DEVICE=$($f.device) HITS=$($f.hits -join ',')"
  }
}
W $pkt "98_crash_detection.txt" $detection | Out-Null

# 97_verdict.json
Write-VerdictJson (Join-Path $pkt "97_verdict.json") ([pscustomobject]@{
  result       = $result
  packetDir    = (Resolve-Path $pkt).Path
  apk          = $apkAbs
  devices      = $devs
  seconds      = $Seconds
  findingsCount= $findings.Count
  findings     = $findings
  excerptsCount= $excerpts.Count
})

# 96_excerpts.txt
if($excerpts.Count -gt 0){
  $excLines = @("EXCERPTS (strongest signal context)")
  foreach($e in $excerpts){
    $excLines += ""
    $excLines += "=== DEVICE=$($e.device) LINES=$($e.startLine)-$($e.endLine) ==="
    $excLines += $e.excerpt
  }
  W $pkt "96_excerpts.txt" $excLines | Out-Null
}

# 00_final.txt — written after signal detection below

# --- V2_3_SIGNAL_BLOCK ---
# Extra signal detection (non-crash but critical failures)
$rxSignals = @(
  '(?i)AndroidRuntime:',
  '(?i)ReactNativeJS:.*(error|exception|fatal)',
  '(?i)Unhandled promise rejection',
  '(?i)Network request failed',
  '(?i)\b(401|403|500|502|503)\b',
  '(?i)ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND',
  '(?i)\bCognito\b|\bJWKS\b|\btoken\b|\bjwt\b',
  '(?i)\bFirestore\b|\bpermission-denied\b|\bunauthenticated\b',
  '(?i)\bIVS\b|\bstage\b|\bbroadcast\b',
  '(?i)\[LIVE_API\]|\bLIVE_API\b|\bGo Live\b'
)

$signalThreshold = 3
$signalHits = @()

foreach($d in $devs){
  $dDir = Join-Path $pkt $d
  $log  = Join-Path $dDir "40_logcat.txt"
  if(-not (Test-Path $log)){ continue }

  $sLines = Get-Content $log
  for($si=0; $si -lt $sLines.Count; $si++){
    $sln = $sLines[$si]
    foreach($rx in $rxSignals){
      if($sln -match $rx){
        $signalHits += [pscustomobject]@{ device=$d; line=$si; rx=$rx; text=$sln }
        break
      }
    }
    if($signalHits.Count -ge 500){ break }
  }
}

$signalOut = Join-Path $pkt "95_signal_hits.txt"
if($signalHits.Count -gt 0){
  "SIGNAL_HITS_COUNT=$($signalHits.Count)" | Out-File -Encoding utf8 $signalOut
  foreach($h in ($signalHits | Select-Object -First 200)){
    Add-Content $signalOut "DEVICE=$($h.device) LINE=$($h.line) RX=$($h.rx)"
    Add-Content $signalOut $h.text
  }
} else {
  "SIGNAL_HITS_COUNT=0" | Out-File -Encoding utf8 $signalOut
}

# Upgrade verdict: crashes still FAIL, but strong signals can also fail
if($result -eq "PASS" -and $signalHits.Count -ge $signalThreshold){
  $result = "FAIL_SIGNAL"
}

# ------------------------------
# v2.4: Split subsystem signals
# ------------------------------
# Packs are *additional* to global detection.
# Each pack writes its own file and can independently upgrade verdict.

$packThresholds = @{
  LIVE = 2
  MSG  = 2
  AUTH = 2
}

# Define pack regex lists (keep them tight; avoid massive noise)
$packDefs = @{
  LIVE = @(
    '(?i)\bIVS\b',
    '(?i)\bstage\b',
    '(?i)\bbroadcast\b',
    '(?i)\bGo Live\b',
    '(?i)\bLIVE_API\b',
    '(?i)\bLIVE_API_TARGET\b',
    '(?i)\bstream(ing)?\b',
    '(?i)\bviewer\b.*\bjoin\b',
    '(?i)\bguest\b.*\bjoin\b',
    '(?i)\bRTMP\b',
    '(?i)\bwebsocket\b.*\bivs\b'
  )
  MSG = @(
    '(?i)\bfirestore\b',
    '(?i)\bpermission-denied\b',
    '(?i)\bPERMISSION_DENIED\b',
    '(?i)\bconversations?\b',
    '(?i)\bmessages?\b',
    '(?i)\bchat\b',
    '(?i)\bnotify\b',
    '(?i)\bFCM\b',
    '(?i)\bpush\b.*\btoken\b'
  )
  AUTH = @(
    '(?i)\bcognito\b',
    '(?i)\bjwt\b',
    '(?i)\baccess[_ -]?token\b',
    '(?i)\bid[_ -]?token\b',
    '(?i)\brefresh[_ -]?token\b',
    '(?i)\bauthorization\b',
    '(?i)\bunauthorized\b',
    '(?i)\b401\b',
    '(?i)\b403\b',
    '(?i)\bJWKS\b',
    '(?i)\bkid\b',
    '(?i)\bsignature\b',
    '(?i)\bAccessDenied\b',
    '(?i)\bNotAuthorized\b'
  )
}

function Find-PackHits {
  param(
    [string]$logText,
    [string[]]$rxList,
    [int]$maxLines = 120
  )
  $hits = New-Object System.Collections.Generic.List[string]
  foreach($rx in $rxList){
    $m = Select-String -InputObject $logText -Pattern $rx -AllMatches
    if($m){
      foreach($mm in $m){
        $line = $mm.Line
        if($line.Length -gt 600){ $line = $line.Substring(0,600) + "…(trunc)" }
        $hits.Add($line)
        if($hits.Count -ge $maxLines){ break }
      }
    }
    if($hits.Count -ge $maxLines){ break }
  }
  # dedupe while preserving order
  $seen = @{}
  $out = New-Object System.Collections.Generic.List[string]
  foreach($h in $hits){
    if(-not $seen.ContainsKey($h)){
      $seen[$h] = $true
      $out.Add($h)
    }
  }
  return ,$out
}

# Read per-device logcat files already produced in this run
$packCounts = @{
  LIVE = 0
  MSG  = 0
  AUTH = 0
}

$packFileMap = @{
  LIVE = (Join-Path $pkt "96_live_signals.txt")
  MSG  = (Join-Path $pkt "96_msg_signals.txt")
  AUTH = (Join-Path $pkt "96_auth_signals.txt")
}

# Initialize pack files
"PACK=LIVE"  | Out-File -Encoding utf8 $packFileMap.LIVE
"PACK=MSG"   | Out-File -Encoding utf8 $packFileMap.MSG
"PACK=AUTH"  | Out-File -Encoding utf8 $packFileMap.AUTH

foreach($d in $devs){
  $logPath24 = Join-Path (Join-Path $pkt $d) "40_logcat.txt"
  if(-not (Test-Path $logPath24)){ continue }
  $logText24 = Get-Content $logPath24 -Raw

  foreach($k in @("LIVE","MSG","AUTH")){
    $pHits = Find-PackHits -logText $logText24 -rxList $packDefs[$k]
    $packCounts[$k] += $pHits.Count

    Add-Content $packFileMap[$k] ""
    Add-Content $packFileMap[$k] ("=== DEVICE=" + $d + " HITS=" + $pHits.Count + " ===")
    foreach($h in $pHits){ Add-Content $packFileMap[$k] $h }
  }
}

# Upgrade verdict based on per-pack thresholds if not already FAIL/FAIL_SIGNAL
$packFail = $null
foreach($k in @("LIVE","MSG","AUTH")){
  if($packCounts[$k] -ge $packThresholds[$k]){
    $packFail = $k
    break
  }
}

if($packFail -and $result -eq "PASS"){
  if($packFail -eq "LIVE"){ $result = "FAIL_LIVE_SIGNAL" }
  elseif($packFail -eq "MSG"){ $result = "FAIL_MSG_SIGNAL" }
  elseif($packFail -eq "AUTH"){ $result = "FAIL_AUTH_SIGNAL" }
}
# --- END V2_4_PACK_BLOCK ---

# --- END V2_3_SIGNAL_BLOCK ---

# 00_final.txt (v2.3: includes signal data)
@(
  "RESULT=$result"
  "PACKET_DIR=$((Resolve-Path $pkt).Path)"
  "APK=$apkAbs"
  "DEVICES=$($devs -join ',')"
  "SECONDS=$Seconds"
  "AUTO_DETECTION=$result"
  "FINDINGS_COUNT=$($findings.Count)"
  "EXCERPTS_COUNT=$($excerpts.Count)"
  "SIGNAL_HITS=$($signalHits.Count)"
  "SIGNAL_THRESHOLD=$signalThreshold"
  "PACK_LIVE=$($packCounts.LIVE)"
  "PACK_MSG=$($packCounts.MSG)"
  "PACK_AUTH=$($packCounts.AUTH)"
  "PACK_FAIL=$(if($packFail){$packFail}else{'NONE'})"
  $(if($findings.Count -gt 0){ "FAIL_REASONS=$($findings | ForEach-Object { "$($_.device):$($_.hits -join '+')" } | Out-String)" } else { "FAIL_REASONS=NONE" })
  "NEXT=Check 97_verdict.json + 95_signal_hits.txt + 96_excerpts.txt + per-device 40_logcat.txt"
) | Out-File -Encoding utf8 (Join-Path $pkt "00_final.txt")

# Update verdict JSON with signal data
Write-VerdictJson (Join-Path $pkt "97_verdict.json") ([pscustomobject]@{
  result        = $result
  packetDir     = (Resolve-Path $pkt).Path
  apk           = $apkAbs
  devices       = $devs
  seconds       = $Seconds
  findingsCount = $findings.Count
  findings      = $findings
  excerptsCount = $excerpts.Count
  signalHits      = $signalHits.Count
  signalThreshold  = $signalThreshold
  packCounts       = $packCounts
  packThresholds   = $packThresholds
  packFail         = $(if($packFail){$packFail}else{$null})
})

Get-Content (Join-Path $pkt "00_final.txt")
"V2_4_VERDICT_DONE: RESULT=$result PACKS=(LIVE=$($packCounts.LIVE),MSG=$($packCounts.MSG),AUTH=$($packCounts.AUTH))"
# --- END V2_2_VERDICT_BLOCK ---
