param(
  [string]$HostLog = '.\\artifacts\\ci\\logcat_host_tags.txt',
  [string]$ViewerLog = '.\\artifacts\\ci\\logcat_viewer_tags.txt',
  [string]$OutPath = '.\\artifacts\\ci\\first_remote_video_removed_context.txt'
)

$ErrorActionPreference = 'Stop'

$rem = Select-String -Path $ViewerLog -Pattern "Emitting event 'IVS_REMOTE_VIDEO_REMOVED'" -Context 12,18 | Select-Object -First 1
if (-not $rem) { throw "No native IVS_REMOTE_VIDEO_REMOVED emit found in viewer log." }

$tsMs = [regex]::Match($rem.Line, '^\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3}').Value
$tsSec = ($tsMs -replace '\.\d{3}$', '')

$window = @($rem.Context.PreContext + $rem.Line + $rem.Context.PostContext)

$vw = Select-String -Path $ViewerLog -Pattern ([regex]::Escape($tsSec)) -Context 25,80 | Select-Object -First 1
$vwWindow = @()
if ($vw) { $vwWindow = @($vw.Context.PreContext + $vw.Line + $vw.Context.PostContext) }

$transitionMarkerPattern = 'Starting guest session|GUEST_SESSION_STARTED|startGuestSession called|startGuestPublishingSession|leaveAsViewerReadOnly|\[IVS_VIEWER\]\[LEAVE_STREAM\]|/api/live/guest-token|/api/live/guest/token|/api/live/guest/(invite|accept)|role.*guest|\[IVS_NATIVE\]\[(LOCAL_VIDEO_ADDED|LOCAL_AUDIO_ADDED)\]|\[IVS_NATIVE\]\[(GUEST_PUBLISH|REMOTE_VIDEO_BOUND)\]'
$expected = (($vwWindow -match $transitionMarkerPattern).Count -gt 0)
$class = if ($expected) { 'LIKELY EXPECTED TRANSITION (viewer->guest / track swap)' } else { 'POTENTIAL UNEXPECTED DROP (no guest transition markers in same-second window)' }

$lines = New-Object System.Collections.Generic.List[string]
$lines.Add('=== VIEWER: FIRST (native) IVS_REMOTE_VIDEO_REMOVED ===')
$lines.Add("TS(ms): $tsMs")
$lines.Add("TS(sec): $tsSec")
$lines.Add("CLASSIFY: $class")
$lines.Add('')
$lines.Add('--- VIEWER tight window (12 before / 18 after) ---')
foreach ($l in $window) { $lines.Add([string]$l) }
$lines.Add('')
$lines.Add('--- VIEWER same-second window (25 before / 80 after) ---')
if ($vw) {
  foreach ($l in $vw.Context.PreContext) { $lines.Add([string]$l) }
  $lines.Add($vw.Line)
  foreach ($l in $vw.Context.PostContext) { $lines.Add([string]$l) }
} else {
  $lines.Add('(no viewer lines found in that second)')
}
$lines.Add('')
$lines.Add("--- HOST same-second window ($tsSec) (25 before / 120 after) ---")
$hw = Select-String -Path $HostLog -Pattern ([regex]::Escape($tsSec)) -Context 25,120 | Select-Object -First 1
if ($hw) {
  foreach ($l in $hw.Context.PreContext) { $lines.Add([string]$l) }
  $lines.Add($hw.Line)
  foreach ($l in $hw.Context.PostContext) { $lines.Add([string]$l) }
} else {
  $lines.Add('(no host lines found in that second)')
}

$lines | Set-Content -Path $OutPath -Encoding UTF8
Write-Output ("WROTE: $OutPath")
