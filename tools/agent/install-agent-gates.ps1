# Install optional local gates (git pre-push). Idempotent.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$gitHooks = Join-Path $Root '.git/hooks'
New-Item -ItemType Directory -Force -Path $gitHooks | Out-Null

$prePush = @'
#!/usr/bin/env sh
set -e
cd "$(git rev-parse --show-toplevel)"
echo "Running verified-forward gate before push..."
npm run verify:forward
'@

$dest = Join-Path $gitHooks 'pre-push'
$prePush | Set-Content -Path $dest -Encoding utf8 -NoNewline
Write-Host "Installed $dest"
Write-Host "Run: powershell -File tools/agent/test-hooks.ps1"
Write-Host "Restart Cursor so .cursor/hooks.json reloads."
