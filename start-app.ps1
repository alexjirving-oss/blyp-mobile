# Blyp Mobile - Proper Startup Script
# This script handles common issues and starts the app correctly

param(
    [switch]$DevClient,
    [switch]$SkipClean,
    [int]$Port,
    [switch]$Tunnel,
    [switch]$Lan,
    [string]$GeminiKey
)

Write-Host "[START] Blyp Mobile - Smart Startup" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Kill any hanging Node processes
Write-Host "1. Cleaning up processes..." -ForegroundColor Yellow
Get-Process -Name "node" -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 1

# Step 2: Clear Metro bundler cache
if ($SkipClean) {
    Write-Host "2. Skipping cache clean (requested)" -ForegroundColor Yellow
} else {
    Write-Host "2. Clearing Metro cache..." -ForegroundColor Yellow
    if (Test-Path ".expo") {
        Remove-Item -Path ".expo" -Recurse -Force
    }
    if (Test-Path "node_modules\.cache") {
        Remove-Item -Path "node_modules\.cache" -Recurse -Force
    }
}

# Step 2c: Load optional .env/.env.local and set env vars (Gemini/Firebase)
Write-Host "2c. Loading environment (.env/.env.local) for Gemini/Firebase..." -ForegroundColor Yellow
function Set-Env-IfPresent {
    param(
        [string]$key,
        [string]$value
    )
    if ($null -ne $value -and $value -ne '') {
        Set-Item -Path ("Env:" + $key) -Value $value
    }
}

# Priority 1: explicit -GeminiKey parameter (does not persist)
if ($GeminiKey) {
    Set-Env-IfPresent -key 'EXPO_PUBLIC_GEMINI_API_KEY' -value $GeminiKey
    Write-Host "   [OK] Using Gemini key from -GeminiKey parameter" -ForegroundColor Green
} else {
    # Priority 2: .env.local then .env (do not print secrets)
    $dotenvFiles = @('.env.local', '.env')
    foreach ($f in $dotenvFiles) {
        if (Test-Path $f) {
            try {
                $lines = Get-Content -Path $f | Where-Object { $_ -match '^[A-Za-z_][A-Za-z0-9_]*=' }
                foreach ($line in $lines) {
                    $eqIndex = $line.IndexOf('=')
                    if ($eqIndex -gt 0) {
                        $k = $line.Substring(0, $eqIndex).Trim()
                        $v = $line.Substring($eqIndex + 1).Trim().Trim('"')
                        if (-not $env:EXPO_PUBLIC_GEMINI_API_KEY -and $k -eq 'EXPO_PUBLIC_GEMINI_API_KEY' -and $v) {
                            $env:EXPO_PUBLIC_GEMINI_API_KEY = $v
                            Write-Host "   [OK] Loaded Gemini key from $f" -ForegroundColor Green
                        }
                        # Load Firebase-related envs if present
                        if ($k -match '^EXPO_PUBLIC_FIREBASE_' -or $k -eq 'EXPO_PUBLIC_FIREBASE_JSON') {
                            if (-not (Get-Item Env:$k -ErrorAction SilentlyContinue)) {
                                Set-Item -Path ("Env:" + $k) -Value $v
                            }
                        }
                    }
                }
            } catch {}
        }
    }
}

if ($env:EXPO_PUBLIC_GEMINI_API_KEY) {
    # Optionally set URL if not provided (code also builds it, but set for clarity)
    if (-not $env:EXPO_PUBLIC_GEMINI_API_URL) {
        $env:EXPO_PUBLIC_GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=$($env:EXPO_PUBLIC_GEMINI_API_KEY)"
    }
} else {
    Write-Host "   [INFO] Gemini key not found in env; AI will run in fallback mode." -ForegroundColor DarkYellow
}

# Step 2d: Ensure Firebase is enabled unless explicitly disabled
try {
    $disableFlag = ("" + $env:EXPO_PUBLIC_DISABLE_FIREBASE).ToLower()
    if ($disableFlag -eq '1' -or $disableFlag -eq 'true') {
        Remove-Item Env:EXPO_PUBLIC_DISABLE_FIREBASE -ErrorAction SilentlyContinue
        Write-Host "2d. Firebase: Unset EXPO_PUBLIC_DISABLE_FIREBASE to enable Firestore/Storage" -ForegroundColor Green
    } else {
        Write-Host "2d. Firebase: Disable flag not set; proceeding enabled if API key present" -ForegroundColor Yellow
    }

    if (-not $env:EXPO_PUBLIC_FIREBASE_API_KEY -or $env:EXPO_PUBLIC_FIREBASE_API_KEY.Trim() -eq '') {
        Write-Host "   [INFO] No EXPO_PUBLIC_FIREBASE_* envs detected. If Firestore stays stubbed, add them to .env/.env.local." -ForegroundColor DarkYellow
    } else {
        Write-Host "   [OK] Firebase env detected for project: $($env:EXPO_PUBLIC_FIREBASE_PROJECT_ID)" -ForegroundColor Green
    }
} catch {}

# Step 2b: Ensure Amplify config exists for local dev
Write-Host "2b. Ensuring Amplify config (src\\aws-exports.js)..." -ForegroundColor Yellow
if (!(Test-Path "src\aws-exports.js")) {
    if ($env:EXPO_PUBLIC_AWS_USER_POOL_ID -and $env:EXPO_PUBLIC_AWS_USER_POOL_WEB_CLIENT_ID -and ($env:EXPO_PUBLIC_AWS_REGION -or $env:EXPO_PUBLIC_AWS_COGNITO_REGION)) {
        try {
            node scripts/generate-aws-exports.js | Out-Host
        } catch {
            Write-Host "   Failed to generate aws-exports.js automatically. You can run: node scripts/generate-aws-exports.js" -ForegroundColor Red
        }
    } else {
        Write-Host "   EXPO_PUBLIC_* env vars not set; Amplify may fail to configure. Set env vars or create src\\aws-exports.js manually." -ForegroundColor DarkYellow
    }
} else {
    Write-Host "   Found src\\aws-exports.js" -ForegroundColor Green
}

# Step 3: Check if ADB is available for USB debugging
Write-Host "3. Checking ADB connection..." -ForegroundColor Yellow
$adbPath = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
if (Test-Path $adbPath) {
    $devices = & $adbPath devices | Select-String -Pattern "device$"
    if ($devices) {
    Write-Host "   [OK] Android device connected via USB" -ForegroundColor Green
        & $adbPath reverse tcp:8081 tcp:8081 | Out-Null
        if ($DevClient) {
            & $adbPath reverse tcp:8083 tcp:8083 | Out-Null
        }
    Write-Host "   [OK] ADB reverse port forwarding enabled" -ForegroundColor Green
    } else {
    Write-Host "   [INFO] No USB device connected (will use QR code / LAN)" -ForegroundColor Gray
    }
} else {
    Write-Host "   [INFO] ADB not found (will use QR code / LAN)" -ForegroundColor Gray
}

# Step 4: Start Expo with clear cache
Write-Host ""
if ($DevClient) {
    Write-Host "4. Starting Expo development server (Dev Client mode)..." -ForegroundColor Yellow
} else {
    Write-Host "4. Starting Expo development server (Expo Go mode)..." -ForegroundColor Yellow
}

# Determine port (prefer 8081 for both Dev Client and Expo Go for consistency)
$chosenPort = if ($Port) { $Port } else { 8081 }

# Determine host strategy (default to LAN unless Tunnel explicitly requested)
if (-not $Tunnel -and -not $Lan) { $Lan = $true }
${hostArg} = ''
if ($Tunnel) { $hostArg = '--tunnel' }
elseif ($Lan) { $hostArg = '--host lan' }

# Determine LAN IP for user convenience
$lanIp = try {
    (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -match '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)' -and $_.InterfaceAlias -notmatch 'vEthernet|Loopback' } | Select-Object -First 1 -ExpandProperty IPAddress)
} catch { $null }

if ($lanIp) {
    Write-Host "[LAN] Detected LAN IP: $lanIp" -ForegroundColor DarkCyan
    # Force React Native packager to advertise this LAN IP so physical devices do not default to 127.0.0.1
    $env:REACT_NATIVE_PACKAGER_HOSTNAME = $lanIp
    Write-Host "   Using LAN IP for REACT_NATIVE_PACKAGER_HOSTNAME" -ForegroundColor DarkCyan
}
Write-Host ""
Write-Host "How to connect:" -ForegroundColor Cyan
if ($DevClient) {
    Write-Host "   * Open your custom dev client and tap 'Open from QR code'" -ForegroundColor White
    Write-Host "   * Or press 'a' to launch on connected Android emulator/device" -ForegroundColor White
    if ($lanIp -and -not $Tunnel) {
        $manualUrl = "exp+blyp-mobile://expo-development-client?url=http://$($lanIp):$($chosenPort)"
    Write-Host "   * Manual URL (paste if needed): $manualUrl" -ForegroundColor Gray
    }
    Write-Host "   * If you see 127.0.0.1 in the dev client list on a physical device, it WILL fail. Use LAN or Tunnel." -ForegroundColor Yellow
} else {
    Write-Host "   * Scan QR code with Expo Go app" -ForegroundColor White
    Write-Host "   * Or press 'a' to open on connected Android device" -ForegroundColor White
}
Write-Host ""
Write-Host "Troubleshooting:" -ForegroundColor Cyan
Write-Host "   * If blank screen: Check Firebase credentials in src/config/firebase.js" -ForegroundColor White
Write-Host "   * If connection fails: Re-run with -Tunnel or -Lan (or press 's' then select)" -ForegroundColor White
Write-Host "   * If device lists 127.0.0.1 project: Start with -Lan or -Tunnel so it advertises reachable host" -ForegroundColor White
Write-Host "   * If app crashes: Check logs below for error messages" -ForegroundColor White
Write-Host ""
Write-Host "Press Ctrl+C to stop the server" -ForegroundColor Gray
Write-Host ""

# Start Expo
if ($DevClient) {
    if ($Tunnel) {
        npx expo start --dev-client --port $chosenPort --tunnel
    } else { # default and -Lan
        npx expo start --dev-client --port $chosenPort --host lan
    }
} else {
    if ($Tunnel) {
        npx expo start --clear --tunnel
    } else { # default and -Lan
        npx expo start --clear --host lan
    }
}