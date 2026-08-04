[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$Name,
  [Parameter(Mandatory=$true)][scriptblock]$Step
)

$ErrorActionPreference = "Stop"

# Guardrail: git must be clean
$porcelain = (git status --porcelain | Out-String).Trim()
if ($porcelain.Length -gt 0) {
  throw "GUARDRAIL FAIL: git dirty before step '$Name'.`n$porcelain"
}

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$stepDir = Join-Path (Resolve-Path ".") ("artifacts\\steps\\" + $ts + "_" + $Name)
New-Item -ItemType Directory -Force -Path $stepDir | Out-Null

$log = Join-Path $stepDir "step.log"
$result = Join-Path $stepDir "RESULT.txt"

function Log($s){ $s | Tee-Object -FilePath $log -Append | Out-Null }

Log "STEP_DIR=$stepDir"
Log "NAME=$Name"
Log "COMMAND=$Command"
Log ""

Log "=== git status (pre) ==="
(& git status -sb 2>&1) | Tee-Object -FilePath $log -Append | Out-Null

Log "=== adb devices -l ==="
(& adb devices -l 2>&1) | Tee-Object -FilePath $log -Append | Out-Null

Log ""
Log "=== RUN ==="
try {
  & $Step 2>&1 | Tee-Object -FilePath (Join-Path $stepDir "stdout.txt") | Out-Null
  "PASS" | Out-File -Encoding UTF8 $result
  exit 0
} catch {
  ("FAIL: " + $_.Exception.Message) | Out-File -Encoding UTF8 $result
  throw
}

Log ""
Log "=== git status (post) ==="
(& git status -sb 2>&1) | Tee-Object -FilePath $log -Append | Out-Null
Log "=== git diff --stat (post) ==="
(& git diff --stat 2>&1) | Tee-Object -FilePath $log -Append | Out-Null
