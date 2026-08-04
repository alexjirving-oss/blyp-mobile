$ErrorActionPreference = 'Continue'

$root = "audit"
$logs = Join-Path $root "logs"
$tmp = Join-Path $root "tmp"

# Ensure audit directories exist
New-Item -ItemType Directory -Force -Path $root, $logs, $tmp | Out-Null

function LogLine($s) {
    $s | Tee-Object -Append -FilePath (Join-Path $root "COMMANDS_RUN.txt")
}

function Run($cmd) {
    LogLine "`n> $cmd"
    try {
        iex $cmd 2>&1 | Tee-Object -Append -FilePath (Join-Path $root "COMMANDS_RUN.txt")
    } catch {
        LogLine "ERR: $($_.Exception.Message)"
    }
}

LogLine '=== LIVE FULL FORENSIC AUDIT START ==='

Run 'Get-Date'
Run 'git status -sb'
Run 'git rev-parse HEAD'
Run 'git log --oneline -n 120'
Run 'git reflog -n 120'
Run 'node -v'
Run 'npm -v'
Run 'ipconfig /all'
Run 'Get-NetIPAddress -AddressFamily IPv4 | Format-Table -AutoSize'

$lan = Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -match '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)' -and $_.IPAddress -ne '127.0.0.1' } |
    Select-Object -First 1 -ExpandProperty IPAddress
if (-not $lan) { $lan = 'UNKNOWN_LAN_IP' }
"LAN_IP_DETECTED=$lan" | Set-Content (Join-Path $root "CONFIG_SNAPSHOT.md")

Run 'dir .env* -ea 0'
Run 'type .env 2>$null'
Run 'type .env.local 2>$null'
Run 'type .env.development 2>$null'
Run 'node -e "console.log(''root scripts'', require(''./package.json'').scripts)"'
if (Test-Path backend/blyp-live-service/package.json) {
    Run 'node -e "console.log(''backend scripts'', require(''./backend/blyp-live-service/package.json'').scripts)"'
}
if (Test-Path functions/package.json) {
    Run 'node -e "console.log(''functions scripts'', require(''./functions/package.json'').scripts)"'
}

$patternLive = 'LiveStream|Go Live|IVS|ivsLiveApi|stageArn|token|viewer|host|broadcast|publish|subscribe|HLS|player|NativeModules|requireNativeComponent'
Run ('npx --yes rg -n "{0}" . -S > {1}/FOUND_PATHS.md' -f $patternLive, $root)
$patternUrls = 'EXPO_PUBLIC_API_BASE_URL|API_BASE_URL|localhost|127\.0\.0\.1|10\.0\.2\.2|5001|3001|4000|https?://'
Run ('npx --yes rg -n "{0}" . -S > {1}/urls_and_ports.txt' -f $patternUrls, $tmp)
Run 'npx --yes expo --version'
Run "npx --yes expo config --type public > $tmp/expo_config_public.txt"
Run "npx --yes expo diagnostics > $tmp/expo_diagnostics.txt"
Run "npx --yes expo-doctor > $tmp/expo_doctor.txt"
Run 'npm ci'
Run "npm ls --depth=0 > $tmp/npm_ls_depth0.txt"
Run ('npx --yes rg -n "throw new Error|not implemented|TODO|FIXME" android ios src -S > {0}/native_redflags.txt' -f $tmp)
Run ('npx --yes rg -n "setRenderSurface|SurfaceView|TextureView|ViewManager|PermissionsAndroid|RECORD_AUDIO|CAMERA|AVCaptureSession" android ios src -S > {0}/native_render_permissions.txt' -f $tmp)

$procs = @()
if (Test-Path backend/blyp-live-service/package.json) {
    Run 'cmd /c "cd backend\blyp-live-service & npm ci"'
    $p = Start-Process -PassThru -FilePath 'cmd.exe' -ArgumentList '/c cd backend\blyp-live-service & npm run dev' -RedirectStandardOutput (Join-Path $logs 'backend_dev.log') -RedirectStandardError (Join-Path $logs 'backend_dev.err.log')
    $procs += $p
    LogLine "BACKEND_DEV_PID=$($p.Id)"
}
if (Test-Path functions/package.json) {
    Run 'cmd /c "cd functions & npm ci"'
    $p = Start-Process -PassThru -FilePath 'cmd.exe' -ArgumentList '/c cd functions & npm run serve' -RedirectStandardOutput (Join-Path $logs 'functions_serve.log') -RedirectStandardError (Join-Path $logs 'functions_serve.err.log')
    $procs += $p
    LogLine "FUNCTIONS_SERVE_PID=$($p.Id)"
}

$metro = Start-Process -PassThru -FilePath 'cmd.exe' -ArgumentList '/c npx expo start --clear' -RedirectStandardOutput (Join-Path $logs 'metro.log') -RedirectStandardError (Join-Path $logs 'metro.err.log')
$procs += $metro
LogLine "METRO_PID=$($metro.Id)"

Run 'netstat -ano | findstr /R "":3001 :4000 :5001 :8081 :19000 :19001"" > audit/tmp/netstat_key_ports.txt'

$adb = (Get-Command adb -ErrorAction SilentlyContinue)
if ($adb) {
    Run 'adb devices'
    Run 'cmd /c "adb logcat -c"'
    $logcat = Start-Process -PassThru -FilePath 'cmd.exe' -ArgumentList '/c adb logcat -v time' -RedirectStandardOutput (Join-Path $logs 'android_logcat.txt') -RedirectStandardError (Join-Path $logs 'android_logcat.err.txt')
    $procs += $logcat
    LogLine "LOGCAT_PID=$($logcat.Id)"
} else {
    LogLine 'ADB_NOT_FOUND=skipped_logcat'
}

@"
MANUAL_STEP_REQUIRED:
1) Open the app (dev-client).
2) Attempt Go Live ONCE.
3) Wait for failure/crash/timeout.
4) Stop here and return control to the agent (do not spam retries).
"@ | Add-Content (Join-Path $root "CONFIG_SNAPSHOT.md")

@"
# LIVE AUDIT REPORT (FORENSIC)
## 1) Symptom
- What exactly happens when pressing Go Live (crash / spinner / permission deny / API fail)
## 2) Resolved Config Truth
- LAN IP detected: $lan
- EXPO_PUBLIC_API_BASE_URL (from env + resolver logic)
- Selected streaming backend (IVS vs HLS/legacy)
- Region/account identifiers presence (no secrets)
## 3) First Failure Point (must be evidence-backed)
- UI -> JS -> Network -> Backend -> AWS -> Native (identify the first broken link)
## 4) Evidence
- metro.log key lines
- backend/functions logs key lines
- android_logcat key stack traces (if present)
- exact failing URL + status code (if network)
- exact native exception + module/method (if crash)
## 5) Ranked Root Causes (Top 5)
Each with:
- Evidence line(s)
- Why it causes Go Live failure
- Minimal fix outline (NO code changes yet)
## 6) Fix Plan (minimal, ordered)
- Step-by-step patch plan with verification checks
## 7) Verification Checklist
- Host can go live
- Viewer can join
- No crash
- Key logs show success path
"@ | Set-Content (Join-Path $root "LIVE_AUDIT_REPORT.md")

LogLine "`n=== AUDIT RUNNING: waiting for MANUAL_STEP_REQUIRED ==="
LogLine 'When user has attempted Go Live once, STOP metro/backend/functions/logcat and then finalize report.'
