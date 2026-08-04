param(
  [string]$Source = 'C:\Users\Alex\369369369',
  [string]$Destination = 'C:\Users\Alex\Blyp26'
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $Source)) {
  throw "Source not found: $Source"
}

if (Test-Path $Destination) {
  throw "Destination already exists: $Destination (rename/remove it or pick a new name)"
}

New-Item -ItemType Directory -Force -Path $Destination | Out-Null

# Reliable recursive copy on Windows
robocopy $Source $Destination /E /COPY:DAT /R:1 /W:1 /NFL /NDL /NP /NJH /NJS | Out-Host

$code = $LASTEXITCODE
Write-Host ("robocopy exit code=" + $code)

# robocopy exit codes: 0-7 are success/ok-with-differences; >=8 indicates failure
if ($code -ge 8) {
  throw ("robocopy failed with exit code " + $code)
}
