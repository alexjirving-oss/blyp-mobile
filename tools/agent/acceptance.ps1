# Full agent acceptance: install gates, hook tests, code verify, live smoke if device.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $Root

function Invoke-Npm {
  param([string]$Script)
  cmd /c "npm run $Script"
  if ($LASTEXITCODE -ne 0) { throw "npm run $Script failed ($LASTEXITCODE)" }
}

$fail = 0
Write-Host "=== Blyp agent gate acceptance ===" -ForegroundColor Cyan

try {
  & (Join-Path $PSScriptRoot 'install-agent-gates.ps1')
} catch {
  Write-Host "WARN: git pre-push install failed: $_" -ForegroundColor Yellow
}

try { Invoke-Npm 'test:hooks' } catch {
  Write-Host "FAIL: hook self-test" -ForegroundColor Red
  $fail = 1
}

try { Invoke-Npm 'verify:forward' } catch {
  Write-Host "FAIL: verify:forward" -ForegroundColor Red
  $fail = 1
}

if ($fail -eq 0) {
  try {
    Invoke-Npm 'verify:live'
  } catch {
    Write-Host "FAIL: verify:live" -ForegroundColor Red
    $fail = 1
  }
}

if ($fail -eq 0) {
  Write-Host ""
  Write-Host "ACCEPTANCE PASS: hooks + code gate + live gate (or live skip with no device)." -ForegroundColor Green
  exit 0
}

Write-Host ""
Write-Host "ACCEPTANCE FAIL" -ForegroundColor Red
exit 1
