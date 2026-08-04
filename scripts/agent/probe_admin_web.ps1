# ==============================================================
# PROBE_ADMIN_WEB
# HTTP-FIRST ADMIN WEB PROOF RAIL
# SAFE: NO APP PATCH -- NO BUILD -- NO DEPLOY
# Fetches live admin pages, extracts key markers, writes timestamped
# diagnostics packet under diagnostics/admin_web_proof/
# ==============================================================

$ErrorActionPreference = "Stop"
Set-Location C:\Users\Alex\Blyp26

function NowTs { Get-Date -Format "yyyyMMdd_HHmmss" }
$ts = NowTs
$packetRoot = "diagnostics\admin_web_proof\ADMIN_WEB_PROOF_$ts"
New-Item -ItemType Directory -Force -Path $packetRoot | Out-Null

$filesCreated = [System.Collections.Generic.List[string]]::new()

function WriteFile([string]$name, [string[]]$lines) {
    $p = Join-Path $packetRoot $name
    $lines | Out-File -Encoding utf8 $p
    $filesCreated.Add($name)
    return $p
}

function WriteRaw([string]$name, [string]$content) {
    $p = Join-Path $packetRoot $name
    [System.IO.File]::WriteAllText($p, $content, [System.Text.Encoding]::UTF8)
    $filesCreated.Add($name)
    return $p
}

# ------------------------------------------------------------------
# Target URLs
# ------------------------------------------------------------------
$urls = @{
    "01_admin_login.html"     = "https://blyp.world/admin-login.html"
    "02_admin_dashboard.html" = "https://blyp.world/admin-dashboard.html"
    "03_admin_user.html"      = "https://blyp.world/admin-user.html"
}
$urlOrder = @("01_admin_login.html", "02_admin_dashboard.html", "03_admin_user.html")

# ------------------------------------------------------------------
# Fetch pages
# ------------------------------------------------------------------
$results = @{}
foreach ($fileName in $urlOrder) {
    $url = $urls[$fileName]
    try {
        $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 30 -ErrorAction Stop
        $results[$fileName] = @{
            Status  = $resp.StatusCode
            Body    = $resp.Content
            Error   = $null
        }
        WriteRaw $fileName $resp.Content | Out-Null
    } catch {
        $errMsg = $_.Exception.Message
        $statusCode = 0
        if ($_.Exception.Response -ne $null) {
            try { $statusCode = [int]$_.Exception.Response.StatusCode } catch {}
        }
        $results[$fileName] = @{
            Status  = $statusCode
            Body    = ""
            Error   = $errMsg
        }
        WriteFile $fileName @("FETCH_FAILED", "URL=$url", "ERROR=$errMsg") | Out-Null
    }
}

# ------------------------------------------------------------------
# Marker extraction helpers
# ------------------------------------------------------------------
function Contains([string]$body, [string]$marker) {
    if ($body -and $body.IndexOf($marker, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) { return "PRESENT" }
    return "ABSENT"
}

function ExtractTitle([string]$body) {
    if (-not $body) { return "(none)" }
    $m = [regex]::Match($body, '<title[^>]*>([^<]*)</title>', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if ($m.Success) { return $m.Groups[1].Value.Trim() }
    return "(no title)"
}

# ------------------------------------------------------------------
# Per-page signal extraction
# ------------------------------------------------------------------
$signals = [System.Collections.Generic.List[string]]::new()
$signals.Add("PACKET=$packetRoot")
$signals.Add("TIMESTAMP=$ts")
$signals.Add("")

# -- admin-login.html --
$loginKey  = "01_admin_login.html"
$loginBody = $results[$loginKey].Body
$loginStatus = $results[$loginKey].Status
$loginError  = $results[$loginKey].Error

$signals.Add("=== admin-login.html ===")
$signals.Add("URL=https://blyp.world/admin-login.html")
$signals.Add("HTTP_STATUS=$loginStatus")
$signals.Add("TITLE=" + (ExtractTitle $loginBody))
if ($loginError) { $signals.Add("FETCH_ERROR=$loginError") }
$signals.Add("MARKER_localStorage_blypAdminSession="      + (Contains $loginBody "localStorage.setItem('blypAdminSession'"))
$signals.Add("MARKER_admin_auth_login="                   + (Contains $loginBody "/admin/auth/login"))
$signals.Add("MARKER_redirect_admin_dashboard="           + (Contains $loginBody "window.location.href = '/admin-dashboard.html'"))
$signals.Add("MARKER_DEFAULT_API_BASE="                   + (Contains $loginBody "DEFAULT_API_BASE"))
$signals.Add("")

# -- admin-dashboard.html --
$dashKey    = "02_admin_dashboard.html"
$dashBody   = $results[$dashKey].Body
$dashStatus = $results[$dashKey].Status
$dashError  = $results[$dashKey].Error

$signals.Add("=== admin-dashboard.html ===")
$signals.Add("URL=https://blyp.world/admin-dashboard.html")
$signals.Add("HTTP_STATUS=$dashStatus")
$signals.Add("TITLE=" + (ExtractTitle $dashBody))
if ($dashError) { $signals.Add("FETCH_ERROR=$dashError") }
$signals.Add("MARKER_x_admin_session="    + (Contains $dashBody "x-admin-session"))
$signals.Add("MARKER_admin_users="        + (Contains $dashBody "/admin/users"))
$signals.Add("MARKER_blypAdminSession="   + (Contains $dashBody "blypAdminSession"))
$signals.Add("")

# -- admin-user.html --
$userKey    = "03_admin_user.html"
$userBody   = $results[$userKey].Body
$userStatus = $results[$userKey].Status
$userError  = $results[$userKey].Error

$signals.Add("=== admin-user.html ===")
$signals.Add("URL=https://blyp.world/admin-user.html")
$signals.Add("HTTP_STATUS=$userStatus")
$signals.Add("TITLE=" + (ExtractTitle $userBody))
if ($userError) { $signals.Add("FETCH_ERROR=$userError") }
$signals.Add("MARKER_x_admin_session="       + (Contains $userBody "x-admin-session"))
$signals.Add("MARKER_admin_dashboard_ref="   + (Contains $userBody "admin-dashboard.html"))
$signals.Add("MARKER_blypAdminSession="      + (Contains $userBody "blypAdminSession"))
$signals.Add("")

WriteFile "04_signals.txt" $signals.ToArray() | Out-Null

# ------------------------------------------------------------------
# PASS/FAIL summary
# ------------------------------------------------------------------
$allPagesFetched = ($loginError -eq $null) -and ($dashError -eq $null) -and ($userError -eq $null)
$loginOk  = ($loginStatus -ge 200 -and $loginStatus -lt 400)
$dashOk   = ($dashStatus -ge 200 -and $dashStatus -lt 400)
$userOk   = ($userStatus -ge 200 -and $userStatus -lt 400)
$allOk    = $loginOk -and $dashOk -and $userOk

$summaryLines = [System.Collections.Generic.List[string]]::new()
$summaryLines.Add("ADMIN_WEB_PROOF SUMMARY")
$summaryLines.Add("=======================")
$summaryLines.Add("PACKET_PATH=$packetRoot")
$summaryLines.Add("TIMESTAMP=$ts")
$summaryLines.Add("")
$summaryLines.Add("URLS_PROBED:")
$summaryLines.Add("  https://blyp.world/admin-login.html")
$summaryLines.Add("  https://blyp.world/admin-dashboard.html")
$summaryLines.Add("  https://blyp.world/admin-user.html")
$summaryLines.Add("")
$summaryLines.Add("PER_PAGE_STATUS:")
$summaryLines.Add("  admin-login.html    HTTP=$loginStatus  $(if ($loginOk) { 'PASS' } else { 'FAIL' })$(if ($loginError) { "  ERROR=$loginError" } else { '' })")
$summaryLines.Add("  admin-dashboard.html HTTP=$dashStatus  $(if ($dashOk) { 'PASS' } else { 'FAIL' })$(if ($dashError) { "  ERROR=$dashError" } else { '' })")
$summaryLines.Add("  admin-user.html     HTTP=$userStatus  $(if ($userOk) { 'PASS' } else { 'FAIL' })$(if ($userError) { "  ERROR=$userError" } else { '' })")
$summaryLines.Add("")

if ($allOk -and $allPagesFetched) {
    $summaryLines.Add("OVERALL_RESULT=PASS")
} else {
    $summaryLines.Add("OVERALL_RESULT=FAIL")
}

$summaryLines.Add("")
$summaryLines.Add("FETCH_FAILURES:")
$anyFetchFail = $false
foreach ($k in $urlOrder) {
    if ($results[$k].Error) {
        $summaryLines.Add("  ${k}: $($results[$k].Error)")
        $anyFetchFail = $true
    }
}
if (-not $anyFetchFail) { $summaryLines.Add("  (none)") }

$summaryLines.Add("")
$summaryLines.Add("See 04_signals.txt for per-page marker extraction.")

WriteFile "00_summary.txt" $summaryLines.ToArray() | Out-Null

# ------------------------------------------------------------------
# Files created index
# ------------------------------------------------------------------
# Ensure ordering: summary + html artifacts already added via WriteFile/WriteRaw
# Add files_created last
$fcLines = [System.Collections.Generic.List[string]]::new()
$fcLines.Add("FILES_CREATED IN $packetRoot")
$fcLines.Add("")
foreach ($f in $filesCreated) { $fcLines.Add($f) }
$fcLines.Add("00_files_created.txt")  # self-reference
$p = Join-Path $packetRoot "00_files_created.txt"
$fcLines.ToArray() | Out-File -Encoding utf8 $p

Write-Host "ADMIN_WEB_PROOF packet written to: $packetRoot"
Write-Host "OVERALL_RESULT=$(if ($allOk -and $allPagesFetched) { 'PASS' } else { 'FAIL' })"
