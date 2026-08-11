#Requires -Version 5.1
<#
.SYNOPSIS
  Unstick Cursor IDE after protect_locked_paths.py started denying on
  JSONDecodeError / empty stdin (blocks Shell/Write for the local agent).

.DESCRIPTION
  Run this OUTSIDE Cursor in Windows PowerShell (Win+X → Windows PowerShell,
  or pwsh). It repairs BOTH worktrees:

    C:\Users\Alex\Blyp26
    C:\Users\Alex\Blyp26-frenemies-ea-v1

  Steps per worktree:
    1) Backup hooks.json + protect_locked_paths.py
    2) Temporarily omit preToolUse from hooks.json (unstick Cursor)
    3) Overwrite protect_locked_paths.py with fail-OPEN parse behavior
    4) Restore hooks.json with preToolUse wired to the fixed script
    5) Smoke-test empty / bad JSON → allow; locked Write → deny

  Locked edit surfaces (Write/StrReplace/Delete/etc) unless env override:
    - Instant For You: src/feed/instant/**
        override: BLYP_ALLOW_INSTANT=1
    - Control-plane: .cursor/**, .accountability/**, tools/accountability/**,
      .github/workflows/**, .github/CODEOWNERS, AGENTS.md, .gitmodules
        override: BLYP_ALLOW_CONTROL_PLANE=1
    - Both: BLYP_HOOK_OVERRIDE=1

.NOTES
  Does NOT claim anything about a remote machine — this only mutates the
  paths above when YOU run it locally.
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Worktrees = @(
  'C:\Users\Alex\Blyp26',
  'C:\Users\Alex\Blyp26-frenemies-ea-v1'
)

$Stamp = Get-Date -Format 'yyyyMMdd_HHmmss'

# ---------------------------------------------------------------------------
# Fixed protect_locked_paths.py — ALLOW on empty stdin / JSONDecodeError
# ---------------------------------------------------------------------------
$ProtectPy = @'
#!/usr/bin/env python3
"""preToolUse: lock Instant For You + control-plane edits; fail OPEN on bad JSON.

Self-inflicted outage mode: never deny when stdin is empty or not JSON.
Only gate Write/StrReplace/Delete/ApplyPatch/EditNotebook-style tools.
"""
from __future__ import annotations

import json
import os
import sys

ALLOW = {"permission": "allow"}

EDIT_TOOLS = {
    "write",
    "strreplace",
    "search_replace",
    "applypatch",
    "apply_patch",
    "editnotebook",
    "edit_notebook",
    "delete",
    "delete_file",
    "deletefile",
}

def deny(msg: str) -> int:
    print(
        json.dumps(
            {
                "permission": "deny",
                "user_message": msg,
                "agent_message": f"Hook DENY: {msg}",
            }
        )
    )
    return 2


def allow() -> int:
    print(json.dumps(ALLOW))
    return 0


def normalize_repo_path(raw: str) -> str:
    """Best-effort repo-relative path (handles Windows abs paths)."""
    if not isinstance(raw, str):
        return ""
    n = raw.replace("\\", "/").strip()
    if not n:
        return ""
    # Strip file://
    if n.lower().startswith("file:///"):
        n = n[8:]
    elif n.lower().startswith("file://"):
        n = n[7:]
    # Strip Windows drive
    if len(n) >= 3 and n[1] == ":" and n[2] == "/":
        n = n[3:]
    n = n.lstrip("/")
    lower = n.lower()
    for root_name in (
        "blyp26/",
        "blyp26-frenemies-ea-v1/",
        "blyp-mobile/",
    ):
        idx = lower.find(root_name)
        if idx >= 0:
            n = n[idx + len(root_name) :]
            lower = n.lower()
            break
    while n.startswith("./"):
        n = n[2:]
    return n


def paths_from_input(inp: dict) -> list[str]:
    paths: list[str] = []
    for key in (
        "path",
        "file_path",
        "target_notebook",
        "notebook_path",
        "filePath",
        "target_file",
    ):
        v = inp.get(key)
        if isinstance(v, str) and v.strip():
            paths.append(normalize_repo_path(v))
    # ApplyPatch-style: old_string/new_string blocks sometimes use "file"
    files = inp.get("files")
    if isinstance(files, list):
        for item in files:
            if isinstance(item, dict):
                for key in ("path", "file_path", "file"):
                    v = item.get(key)
                    if isinstance(v, str) and v.strip():
                        paths.append(normalize_repo_path(v))
            elif isinstance(item, str) and item.strip():
                paths.append(normalize_repo_path(item))
    return [p for p in paths if p]


def is_instant_path(rel: str) -> bool:
    n = rel.replace("\\", "/")
    return n == "src/feed/instant" or n.startswith("src/feed/instant/")


def is_control_plane_path(rel: str) -> bool:
    n = rel.replace("\\", "/")
    if n == "AGENTS.md" or n.endswith("/AGENTS.md"):
        return True
    if n == ".github/CODEOWNERS":
        return True
    if n == ".gitmodules":
        return True
    for prefix in (
        ".cursor/",
        ".accountability/",
        "tools/accountability/",
        ".github/workflows/",
    ):
        if n == prefix.rstrip("/") or n.startswith(prefix):
            return True
    return False


def lock_reason(rel: str) -> str | None:
    override_all = os.environ.get("BLYP_HOOK_OVERRIDE", "").strip() in (
        "1",
        "true",
        "TRUE",
        "yes",
        "YES",
    )
    if override_all:
        return None

    if is_instant_path(rel):
        if os.environ.get("BLYP_ALLOW_INSTANT", "").strip() in (
            "1",
            "true",
            "TRUE",
            "yes",
            "YES",
        ):
            return None
        return (
            "Instant For You is locked (src/feed/instant/**). "
            "Set BLYP_ALLOW_INSTANT=1 or BLYP_HOOK_OVERRIDE=1 to edit."
        )

    if is_control_plane_path(rel):
        if os.environ.get("BLYP_ALLOW_CONTROL_PLANE", "").strip() in (
            "1",
            "true",
            "TRUE",
            "yes",
            "YES",
        ):
            return None
        return (
            "Control-plane path is locked (.cursor/**, .accountability/**, "
            "tools/accountability/**, .github/workflows/**, AGENTS.md, …). "
            "Set BLYP_ALLOW_CONTROL_PLANE=1 or BLYP_HOOK_OVERRIDE=1 to edit."
        )

    return None


def main() -> int:
    # FAIL OPEN: empty / non-JSON stdin must NEVER deny (outage root cause).
    try:
        raw = sys.stdin.read()
    except OSError:
        return allow()

    if raw is None or not str(raw).strip():
        return allow()

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return allow()
    except Exception:
        return allow()

    if not isinstance(data, dict):
        return allow()

    tool = (data.get("tool_name") or data.get("toolName") or "").strip().lower()
    inp = data.get("tool_input") or data.get("arguments") or data.get("input") or {}
    if not isinstance(inp, dict):
        inp = {}

    if tool not in EDIT_TOOLS:
        return allow()

    for rel in paths_from_input(inp):
        reason = lock_reason(rel)
        if reason:
            return deny(f"{reason} Refused path: {rel}")

    return allow()


if __name__ == "__main__":
    raise SystemExit(main())
'@

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
function Write-Utf8NoBom {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Content
  )
  $dir = Split-Path -Parent $Path
  if ($dir -and -not (Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
  }
  $utf8 = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($Path, $Content, $utf8)
}

function Backup-File {
  param([Parameter(Mandatory = $true)][string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  $bak = "$Path.bak_$Stamp"
  Copy-Item -LiteralPath $Path -Destination $bak -Force
  return $bak
}

function Get-HooksObject {
  param([Parameter(Mandatory = $true)][string]$HooksPath)
  if (Test-Path -LiteralPath $HooksPath) {
    try {
      $raw = Get-Content -LiteralPath $HooksPath -Raw -ErrorAction Stop
      if ($raw -and $raw.Trim()) {
        return ($raw | ConvertFrom-Json)
      }
    } catch {
      Write-Warning "Could not parse existing hooks.json; rebuilding a safe baseline. $_"
    }
  }
  # Baseline matching current repo accountability hooks (no preToolUse yet)
  $baseline = @'
{
  "version": 1,
  "hooks": {
    "sessionStart": [
      {
        "command": "python .cursor/hooks/session_start.py",
        "timeout": 15,
        "failClosed": true
      }
    ],
    "afterFileEdit": [
      {
        "command": "python .cursor/hooks/after_file_edit.py",
        "timeout": 15,
        "failClosed": true
      }
    ],
    "stop": [
      {
        "command": "python .cursor/hooks/on_stop_verify.py",
        "timeout": 1200,
        "failClosed": true
      }
    ]
  }
}
'@
  return ($baseline | ConvertFrom-Json)
}

function Remove-PreToolUse {
  param([Parameter(Mandatory = $true)]$HooksObj)
  if ($null -eq $HooksObj.hooks) {
    $HooksObj | Add-Member -NotePropertyName hooks -NotePropertyValue ([pscustomobject]@{}) -Force
  }
  $props = @($HooksObj.hooks.PSObject.Properties | ForEach-Object { $_.Name })
  if ($props -contains 'preToolUse') {
    $HooksObj.hooks.PSObject.Properties.Remove('preToolUse')
  }
  return $HooksObj
}

function Set-PreToolUseFixed {
  param([Parameter(Mandatory = $true)]$HooksObj)
  if ($null -eq $HooksObj.hooks) {
    $HooksObj | Add-Member -NotePropertyName hooks -NotePropertyValue ([pscustomobject]@{}) -Force
  }
  $entry = @(
    [pscustomobject]@{
      command    = 'python .cursor/hooks/protect_locked_paths.py'
      timeout    = 15
      failClosed = $true
    }
  )
  $HooksObj.hooks | Add-Member -NotePropertyName preToolUse -NotePropertyValue $entry -Force
  return $HooksObj
}

function Write-HooksJson {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)]$HooksObj
  )
  $json = $HooksObj | ConvertTo-Json -Depth 20
  Write-Utf8NoBom -Path $Path -Content $json
}

function Invoke-ProtectSmoke {
  param([Parameter(Mandatory = $true)][string]$PyPath)

  $python = Get-Command python -ErrorAction SilentlyContinue
  if (-not $python) {
    $python = Get-Command py -ErrorAction SilentlyContinue
  }
  if (-not $python) {
    Write-Warning "python/py not on PATH — skipped smoke tests for $PyPath"
    return
  }
  $exe = $python.Source

  function Assert-Allow([string]$Label, [string]$Stdin) {
    $out = $Stdin | & $exe $PyPath 2>&1
    $code = $LASTEXITCODE
    $text = ($out | Out-String)
    if ($code -ne 0 -or $text -notmatch '"permission"\s*:\s*"allow"') {
      throw "SMOKE FAIL [$Label]: expected allow. exit=$code out=$text"
    }
    Write-Host "  PASS allow: $Label"
  }

  function Assert-Deny([string]$Label, [string]$Stdin) {
    $out = $Stdin | & $exe $PyPath 2>&1
    $code = $LASTEXITCODE
    $text = ($out | Out-String)
    if ($code -ne 2 -or $text -notmatch '"permission"\s*:\s*"deny"') {
      throw "SMOKE FAIL [$Label]: expected deny. exit=$code out=$text"
    }
    Write-Host "  PASS deny:  $Label"
  }

  Assert-Allow 'empty stdin' ''
  Assert-Allow 'whitespace stdin' "   `n"
  Assert-Allow 'bad JSON' '{not-json'
  Assert-Allow 'Shell tool' '{"tool_name":"Shell","tool_input":{"command":"echo ok"}}'
  Assert-Allow 'Write safe path' '{"tool_name":"Write","tool_input":{"path":"src/foo.ts","contents":"x"}}'
  Assert-Deny  'Write Instant For You' '{"tool_name":"Write","tool_input":{"path":"src/feed/instant/x.ts","contents":"x"}}'
  Assert-Deny  'StrReplace control-plane' '{"tool_name":"StrReplace","tool_input":{"path":".cursor/hooks.json","old_string":"a","new_string":"b"}}'
}

# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
Write-Host ''
Write-Host "=== FIX protect_locked_paths outage ($Stamp) ==="
Write-Host 'Run outside Cursor. Repairing worktrees:'
$Worktrees | ForEach-Object { Write-Host "  - $_" }
Write-Host ''

$repaired = @()
$skipped = @()

foreach ($root in $Worktrees) {
  Write-Host "---- $root ----"
  if (-not (Test-Path -LiteralPath $root)) {
    Write-Warning "Worktree missing — skip: $root"
    $skipped += $root
    continue
  }

  $hooksDir = Join-Path $root '.cursor\hooks'
  $hooksJson = Join-Path $root '.cursor\hooks.json'
  $protectPath = Join-Path $hooksDir 'protect_locked_paths.py'

  New-Item -ItemType Directory -Force -Path $hooksDir | Out-Null

  $bakHooks = Backup-File -Path $hooksJson
  $bakPy = Backup-File -Path $protectPath
  if ($bakHooks) { Write-Host "  backup hooks.json -> $bakHooks" }
  if ($bakPy) { Write-Host "  backup protect_locked_paths.py -> $bakPy" }

  # 1) Temporarily omit preToolUse (unstick Cursor even if py write fails later)
  $obj = Get-HooksObject -HooksPath $hooksJson
  $obj = Remove-PreToolUse -HooksObj $obj
  Write-HooksJson -Path $hooksJson -HooksObj $obj
  Write-Host '  wrote hooks.json WITHOUT preToolUse (temporary)'

  # 2) Overwrite fixed Python (fail-OPEN on parse errors)
  Write-Utf8NoBom -Path $protectPath -Content $ProtectPy
  Write-Host "  wrote $protectPath"

  # 3) Restore hooks.json WITH preToolUse → fixed script
  $obj = Get-HooksObject -HooksPath $hooksJson
  $obj = Remove-PreToolUse -HooksObj $obj
  $obj = Set-PreToolUseFixed -HooksObj $obj
  Write-HooksJson -Path $hooksJson -HooksObj $obj
  Write-Host '  restored hooks.json WITH preToolUse → protect_locked_paths.py'

  # 4) Smoke tests
  Write-Host '  smoke-testing protect_locked_paths.py ...'
  Invoke-ProtectSmoke -PyPath $protectPath

  $repaired += $root
  Write-Host "  OK: $root"
  Write-Host ''
}

Write-Host '=== SUMMARY ==='
if ($repaired.Count -gt 0) {
  Write-Host 'Repaired:'
  $repaired | ForEach-Object { Write-Host "  ✓ $_" }
}
if ($skipped.Count -gt 0) {
  Write-Host 'Skipped (missing):'
  $skipped | ForEach-Object { Write-Host "  - $_" }
}

if ($repaired.Count -eq 0) {
  throw 'No worktrees were repaired. Check paths exist under C:\Users\Alex\.'
}

Write-Host ''
Write-Host 'Next (on your machine):'
Write-Host '  1) Fully quit Cursor (all windows).'
Write-Host '  2) Re-open the worktree.'
Write-Host '  3) Confirm Shell/Write work again.'
Write-Host '  4) Instant For You + control-plane edits still require env overrides.'
Write-Host ''
Write-Host 'Done. This script only changed files on the machine where you ran it.'
