param()

function Get-ConnectedDevices {
  # Use plain `adb devices` (not -l) to avoid wrapped lines that break parsing.
  $lines = & adb devices | Select-Object -Skip 1 | Where-Object { $_ -match "\tdevice$" }
  $devices = @()
  foreach ($l in $lines) {
    $parts = $l -split "\s+"
    if ($parts.Length -ge 1) {
      $serial = $parts[0]
      $devices += [pscustomobject]@{
        Serial  = $serial
        Model   = ""
        Product = ""
      }
    }
  }
  return $devices
}

function Select-TwoDevices {
  param(
    [string]$HostSerial,
    [string]$ViewerSerial
  )

  # PowerShell will unwrap single-item arrays returned from functions; force an array
  # so StrictMode doesn't blow up when only one device is connected.
  $devices = @(Get-ConnectedDevices)
  if ($devices.Count -lt 2) {
    throw "Need at least 2 connected devices. adb devices: $($devices.Serial -join ', ')"
  }

  $hostDev = $null
  $viewerDev = $null

  if ($HostSerial) {
    $hostDev = $devices | Where-Object { $_.Serial -eq $HostSerial }
    if (-not $hostDev) { throw "Host serial '$HostSerial' not found. Connected: $($devices.Serial -join ', ')" }
  }

  if ($ViewerSerial) {
    $viewerDev = $devices | Where-Object { $_.Serial -eq $ViewerSerial }
    if (-not $viewerDev) { throw "Viewer serial '$ViewerSerial' not found. Connected: $($devices.Serial -join ', ')" }
  }

  if (-not $hostDev) { $hostDev = $devices[0] }

  if (-not $viewerDev) {
    $viewerDev = ($devices | Where-Object { $_.Serial -ne $hostDev.Serial })[0]
  }

  if ($hostDev.Serial -eq $viewerDev.Serial) {
    $viewerDev = ($devices | Where-Object { $_.Serial -ne $hostDev.Serial })[0]
  }

  return [pscustomobject]@{
    Host   = $hostDev.Serial
    Viewer = $viewerDev.Serial
    HostInfo   = $hostDev
    ViewerInfo = $viewerDev
  }
}
