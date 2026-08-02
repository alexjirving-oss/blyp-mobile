param(
  [string]$Contract = 'tools/accountability/contracts/smoke-docs.task.json',
  [switch]$PreflightOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Resolve-Node22Runtime {
  $candidates = @()
  $activeNode = (Get-Command node -ErrorAction Stop).Source
  $activeVersion = [Version]((& $activeNode -p "process.versions.node").Trim())
  $candidates += [PSCustomObject]@{
    Version = $activeVersion
    Node    = $activeNode
  }

  if (-not [string]::IsNullOrWhiteSpace($env:NVM_HOME) -and (Test-Path $env:NVM_HOME)) {
    Get-ChildItem -Path $env:NVM_HOME -Directory | ForEach-Object {
      if ($_.Name -match '^v(\d+\.\d+\.\d+)$') {
        $candidateNode = Join-Path $_.FullName 'node.exe'
        if (Test-Path $candidateNode) {
          $candidates += [PSCustomObject]@{
            Version = [Version]$Matches[1]
            Node    = $candidateNode
          }
        }
      }
    }
  }

  $compatible = $candidates | Where-Object { $_.Version -ge [Version]'22.13.0' }
  $selected = $compatible |
    Where-Object { $_.Version.Major -eq 22 } |
    Sort-Object -Property Version -Descending |
    Select-Object -First 1
  if ($null -eq $selected) {
    $selected = $compatible | Sort-Object -Property Version -Descending | Select-Object -First 1
  }
  if ($null -eq $selected) {
    throw 'Cursor SDK requires Node 22.13 or newer, but no compatible runtime is installed.'
  }

  $npmCli = Join-Path (Split-Path -Parent $selected.Node) 'node_modules/npm/bin/npm-cli.js'
  if (-not (Test-Path $npmCli)) {
    throw "Compatible Node runtime has no npm-cli.js: $($selected.Node)"
  }
  return [PSCustomObject]@{
    Version = $selected.Version
    Node    = $selected.Node
    NpmCli  = $npmCli
  }
}

$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$Controller = Join-Path $Root 'tools/accountability'
$Cli = Join-Path $Controller 'dist/src/cli.js'
$ContractPath = Join-Path $Root $Contract
$PublicKeyDirectory = Join-Path $Root '.accountability/keys'
$Runtime = Resolve-Node22Runtime
$Node = $Runtime.Node
$NpmCli = $Runtime.NpmCli
$previousApiKey = $env:CURSOR_API_KEY
$previousPrivateKey = $env:ACCOUNTABILITY_SIGNING_PRIVATE_KEY
$previousNpmExecPath = $env:npm_execpath
$secureApiKey = $null
$secretPointer = [IntPtr]::Zero

Set-Location $Root

try {
  $env:npm_execpath = $NpmCli
  Write-Host "Using Node $($Runtime.Version) for Cursor SDK compatibility." -ForegroundColor Cyan

  & $Node $NpmCli run build --prefix tools/accountability
  if ($LASTEXITCODE -ne 0) {
    throw "Accountability controller build failed with exit code $LASTEXITCODE."
  }

  & $Node $Cli validate $ContractPath
  if ($LASTEXITCODE -ne 0) {
    throw "Smoke contract validation failed with exit code $LASTEXITCODE."
  }
  if ($PreflightOnly) {
    Write-Host "Smoke preflight passed with Node $($Runtime.Version)." -ForegroundColor Green
    return
  }

  if ([string]::IsNullOrWhiteSpace($env:CURSOR_API_KEY)) {
    Write-Host ''
    Write-Host 'Enter your Cursor API key. Input is hidden and is not written to disk.' -ForegroundColor Cyan
    $secureApiKey = Read-Host 'Cursor API key' -AsSecureString
    $secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureApiKey)
    $env:CURSOR_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
  }
  if ([string]::IsNullOrWhiteSpace($env:CURSOR_API_KEY)) {
    throw 'A Cursor API key is required for a live SDK swarm.'
  }

  $keyOutput = & $Node $Cli keygen
  if ($LASTEXITCODE -ne 0) {
    throw "Ephemeral signing-key generation failed with exit code $LASTEXITCODE."
  }
  $keys = $keyOutput | ConvertFrom-Json
  $env:ACCOUNTABILITY_SIGNING_PRIVATE_KEY = [string]$keys.privateKey

  New-Item -ItemType Directory -Force -Path $PublicKeyDirectory | Out-Null
  $publicKeyPath = Join-Path $PublicKeyDirectory 'smoke-public-key.json'
  $publicRecord = @{
    version   = 1
    keyId     = [string]$keys.keyId
    publicKey = [string]$keys.publicKey
    createdAt = [DateTime]::UtcNow.ToString('o')
    purpose   = 'accountability-smoke-proof'
  } | ConvertTo-Json
  [IO.File]::WriteAllText($publicKeyPath, "$publicRecord`n")

  Write-Host ''
  Write-Host 'Launching isolated accountability swarm...' -ForegroundColor Cyan
  & $Node $Cli run $ContractPath --repo $Root
  $runExitCode = $LASTEXITCODE
  if ($runExitCode -ne 0) {
    throw "The live swarm did not produce ACCEPTED (exit code $runExitCode). Evidence remains under .accountability/runs/."
  }

  Write-Host ''
  Write-Host "LIVE ACCOUNTABILITY SMOKE ACCEPTED" -ForegroundColor Green
  Write-Host "Public verification key: $publicKeyPath"
}
finally {
  if ($secretPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
  }
  $env:CURSOR_API_KEY = $previousApiKey
  $env:ACCOUNTABILITY_SIGNING_PRIVATE_KEY = $previousPrivateKey
  $env:npm_execpath = $previousNpmExecPath
}
