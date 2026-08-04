param(
  [switch]$SessionOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $Root

if ($SessionOnly) {
  npm run verify:session
} else {
  npm run verify:forward
}
