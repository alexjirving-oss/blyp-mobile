Param(
    [Parameter(Mandatory=$true)][string]$LogPath,
    [string]$OutPath
)

$ErrorActionPreference = "Stop"
if (-not (Test-Path $LogPath)) {
    throw "Log file not found: $LogPath"
}

if (-not $OutPath) {
    $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
    $outDir = Split-Path $LogPath -Parent
    $OutPath = Join-Path $outDir "ivs_slot_attach_summary_$timestamp.md"
}

$lines = Get-Content $LogPath

$events = @()
foreach ($line in $lines) {
    if ($line -match "IVS_SLOT" -or $line -match "IVS_SURFACE_READY") {
        $events += $line
    }
}

$slotState = @{}
function Ensure-Slot($slotId) {
    if (-not $slotState.ContainsKey($slotId)) {
        $slotState[$slotId] = [ordered]@{
            surface = $false
            track = $false
            attached = $false
            lines = @()
        }
    }
}

foreach ($e in $events) {
    if ($e -match "slotAssigned participant=(?<p>[^ ]+) slot=(?<s>\d+)") {
        $s = [int]$Matches['s']
        Ensure-Slot $s
        $slotState[$s].lines += $e
    }
    elseif ($e -match "surfaceAvailable slot=(?<s>\d+)") {
        $s = [int]$Matches['s']
        Ensure-Slot $s
        $slotState[$s].surface = $true
        $slotState[$s].lines += $e
    }
    elseif ($e -match "trackAdded participant=(?<p>[^ ]+) slot=(?<s>\d+)") {
        $s = [int]$Matches['s']
        Ensure-Slot $s
        $slotState[$s].track = $true
        $slotState[$s].lines += $e
    }
    elseif ($e -match "ATTACHED slot=(?<s>\d+)") {
        $s = [int]$Matches['s']
        Ensure-Slot $s
        $slotState[$s].attached = $true
        $slotState[$s].lines += $e
    }
    elseif ($e -match "tryAttach slot=(?<s>\d+)") {
        $s = [int]$Matches['s']
        Ensure-Slot $s
        $slotState[$s].lines += $e
    }
}

$slots = $slotState.Keys | Sort-Object

$firstFailure = "None"
foreach ($s in $slots) {
    $state = $slotState[$s]
    if (-not $state.surface) { $firstFailure = "Slot $s never had surfaceAvailable"; break }
    if (-not $state.track) { $firstFailure = "Slot $s never saw trackAdded"; break }
    if (-not $state.attached) { $firstFailure = "Slot $s never reached ATTACHED"; break }
}

$sb = New-Object System.Text.StringBuilder
$null = $sb.AppendLine("# IVS Slot Attach Summary")
$null = $sb.AppendLine()
$null = $sb.AppendLine("Log file: ``$LogPath``")
$null = $sb.AppendLine("Generated: ``$(Get-Date -Format 'u')``")
$null = $sb.AppendLine()
$null = $sb.AppendLine("## Per-slot status")
$null = $sb.AppendLine()
$null = $sb.AppendLine("| Slot | Surface | Track | Attached |")
$null = $sb.AppendLine("| ---- | ------- | ----- | -------- |")
foreach ($s in $slots) {
    $state = $slotState[$s]
    $null = $sb.AppendLine("| $s | $($state.surface) | $($state.track) | $($state.attached) |")
}

$null = $sb.AppendLine()
$null = $sb.AppendLine("## First failure point")
$null = $sb.AppendLine()
$null = $sb.AppendLine($firstFailure)

$null = $sb.AppendLine()
$null = $sb.AppendLine("## Matched log lines")
$null = $sb.AppendLine()
foreach ($s in $slots) {
    $null = $sb.AppendLine("### Slot $s")
    $slotLines = $slotState[$s].lines
    foreach ($l in $slotLines) { $null = $sb.AppendLine($l) }
    $null = $sb.AppendLine()
}

Set-Content -Path $OutPath -Value $sb.ToString()
Write-Host "Summary saved to $OutPath" -ForegroundColor Green
