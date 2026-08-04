Set-Location (Resolve-Path ".").Path
$ErrorActionPreference="Stop"

New-Item -ItemType Directory -Force -Path ".\artifacts\ci" | Out-Null
$report = ".\artifacts\ci\verify_report.txt"
if (Test-Path $report) { Remove-Item $report -Force }

function WriteHeader($t){ "==================== $t ====================" | Tee-Object -FilePath $report -Append }
function WriteLine($t){ $t | Tee-Object -FilePath $report -Append }

WriteHeader "REPO / BRANCH / COMMIT PROOF"
WriteLine (git rev-parse --show-toplevel)
WriteLine (git branch --show-current)
WriteLine (git log -1 --oneline --decorate)
WriteLine (git rev-parse HEAD)

WriteHeader "WORKTREE CLEAN?"
WriteLine (git status --porcelain=v1)
WriteLine (git diff --stat)
WriteLine (git diff --name-only)

WriteHeader "COPILOT INSTRUCTIONS HEADS"
WriteLine "--- root/copilot-instructions.md (head) ---"
if (Test-Path ".\copilot-instructions.md") { WriteLine (Get-Content ".\copilot-instructions.md" -TotalCount 40 | Out-String) } else { WriteLine "MISSING: copilot-instructions.md" }

WriteLine "--- .github/copilot-instructions.md (head) ---"
if (Test-Path ".\.github\copilot-instructions.md") { WriteLine (Get-Content ".\.github\copilot-instructions.md" -TotalCount 120 | Out-String) } else { WriteLine "MISSING: .github/copilot-instructions.md" }

WriteHeader "MOVED FILES PROOF"
$checks = @(
  "android\app\src\main\java\com\blyp\mobile\ivs\FirstFrameProbe.kt",
  "src\live\ivs\native\views.ts"
)
foreach ($p in $checks) {
  if (Test-Path $p) {
    $i = Get-Item $p
    WriteLine ("OK: {0}  size={1}  modified={2}" -f $p, $i.Length, $i.LastWriteTime)
  } else {
    WriteLine ("MISSING: {0}" -f $p)
  }
}

WriteLine "--- locate useIVSMultiGuestRegistry.ts ---"
try {
  $hits = & rg -n --hidden --glob "!node_modules/**" "useIVSMultiGuestRegistry" . 2>$null
  if ($hits) { WriteLine (($hits | Select-Object -First 40) -join "`n") } else { WriteLine "NO_HITS" }
} catch { WriteLine "ripgrep_not_available" }

WriteHeader "FINAL_REPORT"
WriteLine ("BRANCH=" + (git branch --show-current))
WriteLine ("COMMIT=" + (git rev-parse HEAD).Trim())
WriteLine "STATUS:"
WriteLine (git status --porcelain=v1)
WriteLine "DIFF_STAT:"
WriteLine (git diff --stat)
WriteLine "CHANGED_FILES_STAGED:"
WriteLine (git diff --cached --name-only)

Write-Host "WROTE_REPORT=$report"
