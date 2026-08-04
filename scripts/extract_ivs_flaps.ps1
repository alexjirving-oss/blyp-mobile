param(
  [Parameter(Mandatory=$true)][string]$HostLogPath,
  [Parameter(Mandatory=$true)][string]$ViewerLogPath,
  [int]$Tail = 260
)

$ErrorActionPreference = 'Stop'

$hostLines   = Get-Content $HostLogPath
$viewerLines = Get-Content $ViewerLogPath

# --- Core patterns ---
# Prefer canonical native emits to avoid counting JS listener registration / debug strings.
$patRemoteAdded   = "Emitting event 'IVS_REMOTE_VIDEO_ADDED'"
$patRemoteRemoved = "Emitting event 'IVS_REMOTE_VIDEO_REMOVED'"

# Real disconnect/error signals only (avoid normal WebRTC churn logs and addListener registrations).
$patDisconnect = "\[IVS_STAGE\] Connection state: DISCONNECTED|Emitting event 'IVS_BROADCAST_ERROR'|ERROR_INVALID_STATE|UnknownHostException|SocketTimeoutException|SSLHandshakeException"

# --- Expected transition markers (viewer leaving read-only + starting guest) ---
$patExpectedTransition = 'leaveAsViewerReadOnly|Leaving viewer session|Starting guest session|startGuestSession|startGuestPublishingSession|GUEST_SESSION_STARTED|/api/live/(guest-token|guest/token)|/api/live/guest/(invite|accept)|\[IVS_NATIVE\]\[(LOCAL_VIDEO_ADDED|LOCAL_AUDIO_ADDED|GUEST_PUBLISH_STARTED)\]'

function IsExpectedAroundIndex([string[]]$lines, [int]$i, [int]$pre=120, [int]$post=220) {
  $start = [Math]::Max(0, $i-$pre)
  $end   = [Math]::Min($lines.Length-1, $i+$post)
  for($j=$start; $j -le $end; $j++){
    if($lines[$j] -match $patExpectedTransition){ return $true }
  }
  return $false
}

function CountMatch([string[]]$lines, [string]$pattern) {
  ( $lines | Select-String -Pattern $pattern ).Count
}

# --- Viewer classification ---
$viewerAddedIdx   = @()
$viewerRemovedIdx = @()
for($i=0; $i -lt $viewerLines.Length; $i++){
  $ln = $viewerLines[$i]
  if($ln -match $patRemoteAdded){   $viewerAddedIdx += $i }
  if($ln -match $patRemoteRemoved){ $viewerRemovedIdx += $i }
}

$viewerExpectedRemovals = 0
$viewerUnexpectedRemovals = 0
foreach($i in $viewerRemovedIdx){
  if(IsExpectedAroundIndex $viewerLines $i){
    $viewerExpectedRemovals++
  } else {
    $viewerUnexpectedRemovals++
  }
}

# --- Disconnects (classify the same way) ---
$viewerDisconnectIdx = @()
for($i=0; $i -lt $viewerLines.Length; $i++){
  if($viewerLines[$i] -match $patDisconnect){ $viewerDisconnectIdx += $i }
}

$viewerExpectedDisconnects = 0
$viewerUnexpectedDisconnects = 0
foreach($i in $viewerDisconnectIdx){
  if(IsExpectedAroundIndex $viewerLines $i){
    $viewerExpectedDisconnects++
  } else {
    $viewerUnexpectedDisconnects++
  }
}

# --- Host counts (simple) ---
$hostRemoteAdded   = CountMatch $hostLines $patRemoteAdded
$hostRemoteRemoved = CountMatch $hostLines $patRemoteRemoved

# --- Summary ---
"`n=== FLAP SUMMARY (hardened) ==="
"VIEWER remoteVideo: added=$($viewerAddedIdx.Count) removedTotal=$($viewerRemovedIdx.Count) removedExpected=$viewerExpectedRemovals removedUnexpected=$viewerUnexpectedRemovals"
"VIEWER disconnects: total=$($viewerDisconnectIdx.Count) expected=$viewerExpectedDisconnects unexpected=$viewerUnexpectedDisconnects"
"HOST   remoteVideo: added=$hostRemoteAdded removed=$hostRemoteRemoved"

$stablePass = ($viewerUnexpectedRemovals -eq 0) -and ($viewerUnexpectedDisconnects -eq 0)
"SOAK_STREAM_STABLE: " + $(if($stablePass){ "PASS" } else { "FAIL" })

# --- Timeline tails (filtered) ---
"`n=== VIEWER timeline (filtered tail) ==="
$viewerLines | Select-String -Pattern "$patRemoteAdded|$patRemoteRemoved|$patDisconnect|$patExpectedTransition|REMOTE_.*(ADDED|REMOVED)|\[IVS_NATIVE\]\[(REMOTE_VIDEO_BOUND|LOCAL_VIDEO_ADDED|LOCAL_AUDIO_ADDED)\]|surface|bind|attach|detach|slot|track|\[LIVE\]\[(MODE_RESOLVED|DECISION_MADE|RECEIVED_ROUTE_PARAMS)\]" |
  Select-Object -Last $Tail | ForEach-Object { $_.Line }

"`n=== HOST timeline (filtered tail) ==="
$hostLines | Select-String -Pattern "$patRemoteAdded|$patRemoteRemoved|$patDisconnect|REMOTE_.*(ADDED|REMOVED)|\[IVS_NATIVE\]\[(REMOTE_VIDEO_BOUND|LOCAL_VIDEO_ADDED|LOCAL_AUDIO_ADDED)\]|surface|bind|attach|detach|slot|track|\[LIVE\]\[(MODE_RESOLVED|DECISION_MADE|RECEIVED_ROUTE_PARAMS)\]" |
  Select-Object -Last $Tail | ForEach-Object { $_.Line }
