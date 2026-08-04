# Requires PowerShell 5+
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $Root

function Test-Hook {
  param(
    [string]$Name,
    [string]$InputJson,
    [scriptblock]$Assert
  )
  $out = $InputJson | python $Hook 2>&1
  $code = $LASTEXITCODE
  & $Assert $out $code
  Write-Host "PASS $Name"
}

$HookDir = Join-Path $Root '.cursor/hooks'
$fail = 0

try {
  python (Join-Path $HookDir 'session_start_reset.py') | Out-Null

  $eas = '{"command":"eas build --platform android"}'
  $out = $eas | python (Join-Path $HookDir 'before_shell_gate.py') 2>&1
  if ($LASTEXITCODE -ne 2 -or $out -notmatch 'deny') { throw "eas build should deny (exit 2)" }
  Write-Host 'PASS deny eas build'

  $allow = '{"command":"npm run typecheck"}'
  $out = $allow | python (Join-Path $HookDir 'before_shell_gate.py') 2>&1
  if ($LASTEXITCODE -ne 0 -or $out -notmatch 'allow') { throw "typecheck should allow" }
  Write-Host 'PASS allow typecheck'

  # Simulate failed verify gate + edit outside touched set
  $session = @{
    files      = @('src/foo.ts')
    file_edits = @{ 'src/foo.ts' = 1 }
    last_gate  = @{ result = 'FAIL'; at = '2026-01-01T00:00:00Z' }
  } | ConvertTo-Json -Depth 5
  $agentDir = Join-Path $Root '.cursor/agent'
  New-Item -ItemType Directory -Force -Path $agentDir | Out-Null
  $sessionPath = Join-Path $agentDir 'session.json'
  [System.IO.File]::WriteAllText($sessionPath, $session)

  $edit = '{"tool_name":"Write","tool_input":{"path":"src/bar.ts","contents":"x"}}'
  $out = $edit | python (Join-Path $HookDir 'pre_tool_use_gate.py') 2>&1
  if ($LASTEXITCODE -ne 2) { throw "preToolUse should deny new file when gate failed" }
  Write-Host 'PASS deny edit when gate failed'

  $forensic = '{"subagent_type":"generalPurpose","prompt":"run gemini browser forensic constraint_probe"}'
  $out = $forensic | python (Join-Path $HookDir 'subagent_start_gate.py') 2>&1
  if ($LASTEXITCODE -ne 2) { throw "forensic subagent should deny" }
  Write-Host 'PASS deny forensic write subagent'

  $prompt = '{"prompt":"fix the bug"}'
  $out = $prompt | python (Join-Path $HookDir 'before_submit_prompt.py') 2>&1
  if ($out -notmatch 'VERIFY GATE FAILED') { throw "beforeSubmitPrompt should inject gate failure" }
  Write-Host 'PASS inject gate failure on prompt'

  python (Join-Path $HookDir 'session_start_reset.py') | Out-Null
  Write-Host ''
  Write-Host 'All hook tests passed.'
}
catch {
  Write-Host "FAIL: $_" -ForegroundColor Red
  $fail = 1
}

exit $fail
