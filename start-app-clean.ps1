param(
    [switch]$DevClient,
    [switch]$Tunnel,
    [switch]$Lan,
    [int]$Port
)

# Minimal clean script to verify connectivity without extra logic
Write-Host "Blyp Minimal Start" -ForegroundColor Cyan

$chosenPort = if ($Port) { $Port } else { if ($DevClient) { 8083 } else { 8081 } }

# Determine LAN IP (first private range match) for advertising to React Native packager
$lanIp = try {
    (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -match '^(10\\.|192\\.168\\.|172\\.(1[6-9]|2[0-9]|3[0-1])\\.)' -and $_.InterfaceAlias -notmatch 'vEthernet|Loopback' } | Select-Object -First 1 -ExpandProperty IPAddress)
} catch { $null }

if ($lanIp) {
    $env:REACT_NATIVE_PACKAGER_HOSTNAME = $lanIp
    Write-Host "Using LAN IP $lanIp for packager hostname" -ForegroundColor DarkCyan
} else {
    Write-Host "Could not determine LAN IP automatically; will rely on Expo host mode" -ForegroundColor DarkYellow
}

$hostArgs = @()
if ($Tunnel) { $hostArgs += '--tunnel' }
elseif ($Lan) { $hostArgs += '--host'; $hostArgs += 'lan' }

if ($DevClient) {
    Write-Host "Starting (dev client) on port $chosenPort $hostArgs" -ForegroundColor Yellow
    npx expo start --dev-client --port $chosenPort @hostArgs
} else {
    Write-Host "Starting (expo go) on default port/mode $hostArgs" -ForegroundColor Yellow
    npx expo start --clear @hostArgs
}
