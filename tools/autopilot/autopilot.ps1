param(
  [int]$MaxIters = 0
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$script:AiderInvoke = "python -m aider"

function Load-DotEnv([string]$path) {
  if (!(Test-Path $path)) { throw "Missing env file: $path" }
  Get-Content $path | ForEach-Object {
    $line = $_.Trim()
    if ($line -eq "" -or $line.StartsWith("#")) { return }
    $idx = $line.IndexOf("=")
    if ($idx -lt 1) { return }
    $k = $line.Substring(0, $idx).Trim()
    $v = $line.Substring($idx + 1).Trim()
    [Environment]::SetEnvironmentVariable($k, $v)
  }
}

function Exec([string]$cmd, [string]$logPath, [string]$displayCmd = "") {
  if ([string]::IsNullOrWhiteSpace($displayCmd)) { $displayCmd = $cmd }
  "`n>>> $displayCmd`n" | Out-File -Append -Encoding utf8 $logPath

  $pinfo = New-Object System.Diagnostics.ProcessStartInfo
  $pinfo.FileName = "powershell"
  $pinfo.Arguments = "-NoProfile -ExecutionPolicy Bypass -Command `"$cmd`""
  $pinfo.RedirectStandardOutput = $true
  $pinfo.RedirectStandardError = $true
  $pinfo.UseShellExecute = $false

  $p = New-Object System.Diagnostics.Process
  $p.StartInfo = $pinfo
  $null = $p.Start()
  $stdout = $p.StandardOutput.ReadToEnd()
  $stderr = $p.StandardError.ReadToEnd()
  $p.WaitForExit()

  $stdout | Out-File -Append -Encoding utf8 $logPath
  $stderr | Out-File -Append -Encoding utf8 $logPath
  return $p.ExitCode
}

function Ensure-GitRepo([string]$logPath) {
  $code = Exec "git rev-parse --is-inside-work-tree" $logPath
  if ($code -ne 0) { throw "Not inside a git repo." }
}

function Ensure-Aider() {
  $candidates = @()

  $pythonCmd = (Get-Command python -ErrorAction SilentlyContinue)
  if ($pythonCmd) { $candidates += "python" }

  $pyLauncher = (Get-Command py -ErrorAction SilentlyContinue)
  if ($pyLauncher) {
    $candidates += "py -3.12"
    $candidates += "py -3.11"
    $candidates += "py -3.10"
  }

  if ($candidates.Count -eq 0) {
    throw "No Python found. Install Python (or the Windows 'py' launcher) and try again."
  }

  foreach ($py in $candidates) {
    Write-Host "[autopilot] Ensuring aider-chat installed via: $py"

    $pipUp = Exec "$py -m pip install --upgrade pip" $log
    if ($pipUp -ne 0) { continue }

    $aiderUp = Exec "$py -m pip install --upgrade aider-chat" $log
    if ($aiderUp -ne 0) { continue }

    $ver = Exec "$py -m aider --version" $log
    if ($ver -eq 0) {
      $script:AiderInvoke = "$py -m aider"
      Write-Host "[autopilot] Using Aider via: $script:AiderInvoke"
      return
    }
  }

  throw "Unable to run Aider via python module. See $log for pip/aider output."
}

function Ensure-Branch([string]$logPath) {
  $branch = ("autopilot/live-broadcast-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
  Exec "git checkout -b $branch" $logPath | Out-Null
}

function Build-Prompt([int]$iter, [string]$failLogPath) {
  $spec = Get-Content "$PSScriptRoot\SPEC.md" -Raw
  $acc  = Get-Content "$PSScriptRoot\ACCEPTANCE.md" -Raw
  $fail = ""
  if (Test-Path $failLogPath) { $fail = Get-Content $failLogPath -Raw }

  $prompt = "You are an autonomous senior engineer working inside this git repo.`n`n" +
    "NON-NEGOTIABLES:`n" +
    "- Production-grade only. No placeholders. No mocks unless explicitly required.`n" +
    "- Keep changes minimal and safe.`n" +
    "- Do not regress existing features.`n" +
    "- If something is unclear, infer from code + tests and implement the most robust solution.`n`n" +
    "Read and implement:`n" +
    "--- SPEC ---`n" + $spec + "`n`n" +
    "--- ACCEPTANCE ---`n" + $acc + "`n`n" +
    "Iteration: $iter`n`n" +
    "Recent failures (if any):`n" + $fail + "`n`n" +
    "Task:`n" +
    "1) Implement the next missing parts of SPEC/ACCEPTANCE.`n" +
    "2) Make code changes directly in the repo.`n" +
    "3) Make tests/typecheck/lint pass.`n" +
    "4) If you must add tests, add the minimal set that proves correctness.`n`n" +
    "Finish when you're confident validation will pass.`n"

  return $prompt
}

# --- main ---
$logDir = Join-Path $PSScriptRoot "logs"
New-Item -ItemType Directory -Force $logDir | Out-Null
$log = Join-Path $logDir ("autopilot-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".log")
$failLog = Join-Path $logDir "last-fail.log"

Load-DotEnv (Join-Path $PSScriptRoot ".env.autopilot")

$Model = $env:AIDER_MODEL
$ApiKey = $env:AIDER_API_KEY
if ([string]::IsNullOrWhiteSpace($Model) -or [string]::IsNullOrWhiteSpace($ApiKey)) {
  throw "Set AIDER_MODEL and AIDER_API_KEY in tools/autopilot/.env.autopilot"
}

$Typecheck = $env:AUTOPILOT_TYPECHECK_CMD
$Lint      = $env:AUTOPILOT_LINT_CMD
$Test      = $env:AUTOPILOT_TEST_CMD

$max = 0
if ($MaxIters -gt 0) {
  $max = $MaxIters
} else {
  $envMax = $env:AUTOPILOT_MAX_ITERS
  if ([string]::IsNullOrWhiteSpace($envMax)) { $envMax = "12" }
  $max = [int]$envMax
}

Ensure-GitRepo $log
Ensure-Aider
Ensure-Branch $log

for ($i = 1; $i -le $max; $i++) {
  Write-Host "[autopilot] Iteration $i/$max"
  $promptPath = Join-Path $logDir "prompt-$i.txt"
  Build-Prompt $i $failLog | Out-File -Encoding utf8 $promptPath

  $aiderCmd = "$script:AiderInvoke --model `"$Model`" --api-key `"$ApiKey`" --message-file `"$promptPath`" --yes"
  $aiderCmdForLog = "$script:AiderInvoke --model `"$Model`" --api-key `"<REDACTED>`" --message-file `"$promptPath`" --yes"
  $code = Exec $aiderCmd $log $aiderCmdForLog
  if ($code -ne 0) {
    "AIDER FAILED with exit code $code" | Out-File -Encoding utf8 $failLog
    continue
  }

  $typeOk = Exec $Typecheck $log
  $lintOk = Exec $Lint $log
  $testOk = Exec $Test $log

  if ($typeOk -eq 0 -and $lintOk -eq 0 -and $testOk -eq 0) {
    Write-Host "[autopilot] PASS"
    exit 0
  }

  $failText = "VALIDATION FAILED:`n" +
    "typecheck exit=$typeOk`n" +
    "lint exit=$lintOk`n" +
    "test exit=$testOk`n`n" +
    "See full log:`n" +
    "$log`n"
  $failText | Out-File -Encoding utf8 $failLog

  Write-Host "[autopilot] FAIL - looping with failure context"
}

Write-Host "[autopilot] Gave up after $max iterations. Check $log"
exit 2
