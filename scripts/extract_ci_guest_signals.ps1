param(
  [Alias('HostLogPath','HostLog')]
  [string]$HostPath = "c:\Users\Alex\Blyp26\artifacts\ci\logcat_host_tags.txt",

  [Alias('ViewerLogPath','ViewerLog')]
  [string]$ViewerPath = "c:\Users\Alex\Blyp26\artifacts\ci\logcat_viewer_tags.txt",

  [string]$LogsDir = "c:\Users\Alex\Blyp26\logs",
  [int]$Tail = 2000
)

$ErrorActionPreference = "Stop"

Set-Location 'c:\Users\Alex\Blyp26'

function Resolve-LatestLogPath([string]$dir, [string]$pattern, [string]$label) {
  if ([string]::IsNullOrWhiteSpace($dir)) { return $null }
  if (-not (Test-Path $dir)) { return $null }

  $candidate = Get-ChildItem -Path $dir -Filter $pattern -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

  if (-not $candidate) { return $null }
  return $candidate.FullName
}

function Resolve-InputPath([string]$path, [string]$fallbackDir, [string]$fallbackPattern, [string]$label) {
  if (-not [string]::IsNullOrWhiteSpace($path) -and (Test-Path $path)) { return $path }

  $fallback = Resolve-LatestLogPath -dir $fallbackDir -pattern $fallbackPattern -label $label
  if ($fallback) { return $fallback }

  throw "$label log not found. Tried: '$path' and latest '$fallbackPattern' under '$fallbackDir'."
}

function Get-TailLines([string]$path, [int]$tail) {
  Get-Content -Path $path -Tail $tail -ErrorAction Stop
}

function Count-Matches($lines, [string]$pattern) {
  ($lines | Select-String -Pattern $pattern -ErrorAction SilentlyContinue).Count
}

function Count-MatchesInFile([string]$path, [string]$pattern) {
  if ([string]::IsNullOrWhiteSpace($path) -or -not (Test-Path $path)) { return 0 }
  (Select-String -Path $path -Pattern $pattern -ErrorAction SilentlyContinue).Count
}

# --- Semantic endpoint + log-message aliases ---
# Request: endpoint + log markers + state
$patGuestRequest = '/api/live/guest/request|\[LIVE_API\]\[REQUEST_GUEST_SLOT\]|"status"\s*:\s*"REQUESTED"'

# Approve/invite: host endpoint OR viewer state transition to INVITED
$patHostApprove  = '/api/live/guest/(invite|accept|approve)|\[LIVE_API\]\[(INVITE|ACCEPT|APPROVE)_GUEST\]'
$patViewerInvited = '"status"\s*:\s*"INVITED"'

# Guest token mint: endpoint + log markers
$patGuestToken   = '/api/live/guest/(token|guest-token)|\[LIVE_API\]\[CREATE_GUEST_TOKEN\]|\[IVS_VIEWER\]\[(GUEST_)?TOKEN_RECEIVED\]'

# --- Publish-proof (match REAL strings you have today) ---
# Include canonical native markers so strict greps stay stable.
$patPublishProof = 'Starting guest session|GUEST_SESSION_STARTED|Local track update|videoEnabled|audioEnabled|IVS_CLIENT\].*Local broadcast joined|Local broadcast joined|\[IVS_NATIVE\]\[LOCAL_VIDEO_ADDED\]|\[IVS_NATIVE\]\[LOCAL_AUDIO_ADDED\]|\[IVS_NATIVE\]\[GUEST_PUBLISH_STARTED\]'

$resolvedHostPath = Resolve-InputPath -path $HostPath -fallbackDir $LogsDir -fallbackPattern '*logcat_host_*.log' -label 'HOST'
$resolvedViewerPath = Resolve-InputPath -path $ViewerPath -fallbackDir $LogsDir -fallbackPattern '*logcat_viewer_*.log' -label 'VIEWER'

$hostLines   = Get-TailLines $resolvedHostPath $Tail
$viewerLines = Get-TailLines $resolvedViewerPath $Tail

# For CI correctness, count across the full files (logs can be large enough
# that key events fall outside a small tail).
$reqCount     = Count-MatchesInFile $resolvedViewerPath $patGuestRequest
$approveCount = (Count-MatchesInFile $resolvedHostPath $patHostApprove) + (Count-MatchesInFile $resolvedViewerPath $patViewerInvited)
$tokenCount   = Count-MatchesInFile $resolvedViewerPath $patGuestToken
$publishCount = Count-MatchesInFile $resolvedViewerPath $patPublishProof

# --- Slot-0 continuity assertion (prevents "fullscreen black" regressions) ---
# After the viewer transitions into guest mode, slot 0 must still bind to a remote video track.
$guestStart = Select-String -Path $resolvedViewerPath -Pattern 'Starting guest session|GUEST_SESSION_STARTED|startGuestSession|startGuestPublishingSession' -ErrorAction SilentlyContinue | Select-Object -First 1
$slot0RemoteBoundAfterGuest = $false
if ($guestStart) {
  $slot0RemoteBoundAfterGuest = $null -ne (
    Select-String -Path $resolvedViewerPath -Pattern '\[IVS_NATIVE\]\[REMOTE_VIDEO_BOUND\].*(slot=0|slotId=0)' -ErrorAction SilentlyContinue |
      Where-Object { $_.LineNumber -ge $guestStart.LineNumber } |
      Select-Object -First 1
  )
}

# --- Host must receive guest video on a guest slot (2+) ---
# Ensures the host actually receives the guest's remote video and it is not (incorrectly) mapped into slot 0/1.
$hostReceivedGuestVideoSlotGE2 = $false
$hostReceivedGuestVideoSlotGE2 = $null -ne (
  Select-String -Path $resolvedHostPath -Pattern '\[IVS_BRIDGE\]\[REMOTE_VIDEO_ADDED\].*slotIndex=([2-9]|[1-9][0-9]+)' -ErrorAction SilentlyContinue |
    Select-Object -First 1
)

# After guest start, ensure slot 0 surface becomes available again after the last clearHostPreviewTargets.
$slot0SurfaceTrueAfterLastClear = $false
if ($guestStart) {
  $lastClear = Select-String -Path $resolvedViewerPath -Pattern 'clearHostPreviewTargets' -ErrorAction SilentlyContinue |
    Where-Object { $_.LineNumber -ge $guestStart.LineNumber } |
    Select-Object -Last 1

  $baselineLine = if ($lastClear) { $lastClear.LineNumber } else { $guestStart.LineNumber }

  $slot0SurfaceTrueAfterLastClear = $null -ne (
    Select-String -Path $resolvedViewerPath -Pattern 'setViewerSlotSurface.*slot=0.*surface=true|\[IVS_SLOT\] setViewerSlotSurface slot=0 surface=true' -ErrorAction SilentlyContinue |
      Where-Object { $_.LineNumber -ge $baselineLine } |
      Select-Object -First 1
  )
}

$pass = ($reqCount -gt 0) -and ($approveCount -gt 0) -and ($tokenCount -gt 0) -and ($publishCount -gt 0) -and ($slot0RemoteBoundAfterGuest) -and ($slot0SurfaceTrueAfterLastClear) -and ($hostReceivedGuestVideoSlotGE2)

"CI_GUEST_E2E: " + ($(if ($pass) { 'PASS' } else { 'FAIL' }))
"Counts: request=$reqCount approve=$approveCount token=$tokenCount publishProof=$publishCount"
"Assert: viewerSlot0RemoteBoundAfterGuest=$slot0RemoteBoundAfterGuest"
"Assert: viewerSlot0SurfaceTrueAfterLastClear=$slot0SurfaceTrueAfterLastClear"
"Assert: hostReceivedGuestVideoSlotGE2=$hostReceivedGuestVideoSlotGE2"

# Keep a compact tail excerpt for humans (doesn't affect CI parsing)
$pat = $patPublishProof +
       '|REMOTE_VIDEO|REMOTE_AUDIO|REMOTE_.*(ADDED|REMOVED)|Remote track|participant|Participant|track|Track|slot|Slot|surface|Surface|STAGE|Stage' +
       '|/api/live/(start|join-realtime)' +
       '|/api/live/guest/(request|accept|reject|invite|token|requests|me)' +
       '|/api/live/guest-token'

function Get-FirstUid([string]$p) {
  $m = Select-String -Path $p -Pattern "\[AUTH DEBUG\].*uid:\s*'([^']+)'" -List -ErrorAction SilentlyContinue
  if (-not $m) { return $null }
  return $m.Matches[0].Groups[1].Value
}

"HOST file:   $HostPath"
"VIEWER file: $ViewerPath"
"HOST resolved:   $resolvedHostPath"
"VIEWER resolved: $resolvedViewerPath"
"HOST uid:    $(Get-FirstUid $resolvedHostPath)"
"VIEWER uid:  $(Get-FirstUid $resolvedViewerPath)"

"\n---HOST key signals (last $Tail)---"
$hostLines | Select-String -Pattern $pat | Select-Object -Last $Tail | ForEach-Object { $_.Line }

"\n---VIEWER key signals (last $Tail)---"
$viewerLines | Select-String -Pattern $pat | Select-Object -Last $Tail | ForEach-Object { $_.Line }
