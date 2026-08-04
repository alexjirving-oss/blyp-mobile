$ErrorActionPreference = 'Stop'

function Show-Viewer {
  $p = Get-ChildItem -Path './logs' -Filter 'logcat_viewer_*.log' | Sort-Object LastWriteTime -Descending | Select-Object -First 1 | Select-Object -ExpandProperty FullName
  if (-not $p) { throw 'No viewer log found under ./logs' }
  Write-Host "Using viewer log: $p"
  $re = 'ReactNativeJS|\[LIVE\]|IVS_PROOF|IVS_NATIVE|IVS_BIND|IVS_TRACE|\[IVS_|IVS_SLOT|IVS_SURFACE|IVSRealTimeView|IVS_REALTIME_VIEW|ATTACH_DECISION|ATTACH_EXEC|REMOTE_VIDEO_ADDED|REMOTE_PARTICIPANT_|PixelCopy|firstFrame|TIMEOUT|ERROR_SOURCE|ERROR_TIMEOUT|ERROR_SOURCE_NO_DATA|ERROR_SOURCE_INVALID|AndroidRuntime'
  Write-Host '---- COUNTS ----'
  Write-Host ('IVS_PROOF: '     + ((Select-String -Path $p -Pattern 'IVS_PROOF'     -SimpleMatch | Measure-Object).Count))
  Write-Host ('IVS_BIND: '      + ((Select-String -Path $p -Pattern 'IVS_BIND'      -SimpleMatch | Measure-Object).Count))
  Write-Host ('IVS_TRACE: '     + ((Select-String -Path $p -Pattern 'IVS_TRACE'     -SimpleMatch | Measure-Object).Count))
  Write-Host ('ATTACH_DECISION: '+ ((Select-String -Path $p -Pattern 'ATTACH_DECISION' -SimpleMatch | Measure-Object).Count))
  Write-Host ('ATTACH_EXEC: '   + ((Select-String -Path $p -Pattern 'ATTACH_EXEC'   -SimpleMatch | Measure-Object).Count))
  Write-Host ('PixelCopy: '     + ((Select-String -Path $p -Pattern 'PixelCopy'     -SimpleMatch | Measure-Object).Count))
  Write-Host ('firstFrame: '    + ((Select-String -Path $p -Pattern 'firstFrame'    -SimpleMatch | Measure-Object).Count))
  Write-Host ''
  Write-Host '---- LAST 120 RELEVANT LINES ----'
  Select-String -Path $p -Pattern $re | Select-Object -Last 120
}

function Show-Host {
  $p = Get-ChildItem -Path './logs' -Filter 'logcat_host_*.log' | Sort-Object LastWriteTime -Descending | Select-Object -First 1 | Select-Object -ExpandProperty FullName
  if (-not $p) { throw 'No host log found under ./logs' }
  Write-Host "Using host log: $p"
  $re = 'IVS_PROOF|IVS_NATIVE|IVS_BIND|IVS_TRACE|\[IVS_|IVS_SURFACE|IVS_HOST|IVSBroadcast|clearHostPreviewTargets|UnknownHostException|live-video\.net|ERROR_TYPE|ERROR_INVALID_STATE|DISCONNECTED|Join|AndroidRuntime'
  Write-Host '---- COUNTS ----'
  Write-Host ('IVS_PROOF: '     + ((Select-String -Path $p -Pattern 'IVS_PROOF'     -SimpleMatch | Measure-Object).Count))
  Write-Host ('IVS_BIND: '      + ((Select-String -Path $p -Pattern 'IVS_BIND'      -SimpleMatch | Measure-Object).Count))
  Write-Host ('IVS_TRACE: '     + ((Select-String -Path $p -Pattern 'IVS_TRACE'     -SimpleMatch | Measure-Object).Count))
  Write-Host ('UnknownHost: '   + ((Select-String -Path $p -Pattern 'UnknownHostException' -SimpleMatch | Measure-Object).Count))
  Write-Host ''
  Write-Host '---- LAST 120 RELEVANT LINES ----'
  Select-String -Path $p -Pattern $re | Select-Object -Last 120
}

Show-Viewer
Write-Host "`n===========================`n"
Show-Host
