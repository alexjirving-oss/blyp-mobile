param()

function Ensure-Directory {
  param([string]$Path)
  if (-not (Test-Path $Path)) {
    New-Item -ItemType Directory -Force -Path $Path | Out-Null
  }
}

function Get-PortOwner {
  param([int]$Port)
  try {
    $conns = Get-NetTCPConnection -LocalPort $Port -ErrorAction Stop
    if ($conns) {
      $conn = $conns | Select-Object -First 1
      # Occasionally OwningProcess may be 0 (unknown). Fall back to netstat.
      if ($conn.OwningProcess -and $conn.OwningProcess -ne 0) {
        return $conn
      }

      try {
        $line = (netstat -ano | Select-String -Pattern ("\sLISTENING\s+\d+\s*$") | Select-String -Pattern (":$Port\s")) | Select-Object -First 1
        if ($line) {
          $parts = ($line.Line -replace "\s+", " ").Trim().Split(' ')
          $pid = [int]$parts[-1]
          if ($pid -gt 0) {
            $conn | Add-Member -NotePropertyName OwningProcess -NotePropertyValue $pid -Force
          }
        }
      } catch {}
      return $conn
    }
  } catch {
    return $null
  }
  return $null
}

function Start-LoggedProcess {
  param(
    [string]$WorkingDirectory,
    [string]$Command,
    [string]$WindowTitle,
    [string]$LogPath
  )

  Ensure-Directory -Path (Split-Path $LogPath -Parent)
  $escapedCmd = "cd '$WorkingDirectory'; $Command 2>&1 | Tee-Object -FilePath '$LogPath' -Append"
  $psArgs = @('-NoExit','-Command', $escapedCmd)
  $proc = Start-Process -FilePath powershell -ArgumentList $psArgs -WindowStyle Normal -PassThru
  if ($WindowTitle) {
    try { $proc.MainWindowTitle = $WindowTitle } catch {}
  }
  return $proc
}
