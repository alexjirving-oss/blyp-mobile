[CmdletBinding()]
param()
$ErrorActionPreference = "Stop"

$raw = & adb devices -l 2>&1
if ($LASTEXITCODE -ne 0) { Write-Error ($raw -join "`n"); exit 1 }

$devices = New-Object System.Collections.Generic.List[object]
foreach ($line in $raw) {
  if ($line -match '^\s*$') { continue }
  if ($line -match '^(List of devices attached|\* daemon)') { continue }
  if ($line -match '^(?<id>\S+)\s+device(\s|$)') {
    $devices.Add([pscustomobject]@{ Serial = $Matches["id"]; Line = $line })
  }
}

$devices = @($devices | Sort-Object Serial -Unique)
if (@($devices).Length -lt 1) { Write-Error "No authorized devices found."; exit 1 }

$devices
exit 0
