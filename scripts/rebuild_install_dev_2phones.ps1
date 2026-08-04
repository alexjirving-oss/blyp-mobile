param(
  [Parameter(Mandatory=$true)][string]$HostSerial,
  [Parameter(Mandatory=$true)][string]$ViewerSerial,
  [switch]$SkipTypecheck,
  [switch]$SkipDeps,
  [switch]$NoUninstall,
  [ValidateSet("debug")][string]$Variant = "debug"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-AppExe([string]$name) {
  $cmd = (Get-Command $name -All -ErrorAction SilentlyContinue | Where-Object { $_.CommandType -eq 'Application' } | Select-Object -First 1)
  if ($cmd -and $cmd.Source) { return [string]$cmd.Source }
  $cmd = (Get-Command $name -ErrorAction SilentlyContinue | Select-Object -First 1)
  if ($cmd -and $cmd.Source) { return [string]$cmd.Source }
  return $null
}

$adbCmd = (Get-Command adb -All -ErrorAction SilentlyContinue | Where-Object { $_.CommandType -eq 'Application' } | Select-Object -First 1)
if (-not $adbCmd) { $adbCmd = (Get-Command adb -ErrorAction SilentlyContinue | Select-Object -First 1) }
$adbExe = $adbCmd.Source

$nodeExe = Resolve-AppExe "node"
$npmExe  = Resolve-AppExe "npm"
$npxExe  = Resolve-AppExe "npx"
$pnpmExe = Resolve-AppExe "pnpm"
$yarnExe = Resolve-AppExe "yarn"

function Adb {
  param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$AdbArgs
  )
  if (-not $adbExe) { throw "Missing dependency: 'adb' not found in PATH." }
  & $adbExe @AdbArgs
}

function Invoke-AdbWithTimeout {
  param(
    [Parameter(Mandatory = $true)][string[]]$AdbArgs,
    [int]$TimeoutMs = 20000,
    [switch]$ThrowOnTimeout
  )
  if (-not $adbExe) { throw "Missing dependency: 'adb' not found in PATH." }
  $tmpOut = [System.IO.Path]::GetTempFileName()
  $tmpErr = [System.IO.Path]::GetTempFileName()
  try {
    $p = Start-Process -FilePath $adbExe -ArgumentList $AdbArgs -NoNewWindow -PassThru -RedirectStandardOutput $tmpOut -RedirectStandardError $tmpErr
    if (-not $p.WaitForExit($TimeoutMs)) {
      try { $p.Kill() } catch {}
      if ($ThrowOnTimeout) { throw "adb timed out after ${TimeoutMs}ms: $($AdbArgs -join ' ')" }
      return $false
    }
    return $true
  } finally {
    Remove-Item -LiteralPath $tmpOut,$tmpErr -Force -ErrorAction SilentlyContinue
  }
}

function Assert-Cmd([string]$name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "Missing dependency: '$name' not found in PATH."
  }
}

function Get-PackageManager {
  if (Test-Path "pnpm-lock.yaml") { return "pnpm" }
  if (Test-Path "yarn.lock") { return "yarn" }
  if (Test-Path "package-lock.json") { return "npm" }
  return "npm"
}

function Install-Deps([string]$pm) {
  if ($SkipDeps) { Write-Host "[SKIP] deps"; return }

  Write-Host "[DEPS] package manager: $pm"
  switch ($pm) {
    "pnpm" { if (-not $pnpmExe) { throw "Missing dependency: 'pnpm' not found in PATH." }; & $pnpmExe install --frozen-lockfile }
    "yarn" {
      if (-not $yarnExe) { throw "Missing dependency: 'yarn' not found in PATH." }
      $isBerry = (Test-Path ".yarnrc.yml") -or (Test-Path ".yarn")
      if ($isBerry) { & $yarnExe install --immutable } else { & $yarnExe install --frozen-lockfile }
    }
    "npm"  {
      if (-not $npmExe) { throw "Missing dependency: 'npm' not found in PATH." }
      if (Test-Path "package-lock.json") { & $npmExe ci } else { & $npmExe install }
    }
  }
}

function Get-ExpoAndroidPackageId {
  # Best source of truth for managed/dev-client projects
  try {
    if (-not $npxExe) { throw "Missing dependency: 'npx' not found in PATH." }
    $raw = (& $npxExe --yes expo config --json 2>$null)
    if ($raw) {
      $cfg = $raw | ConvertFrom-Json
      if ($cfg.android -and $cfg.android.package) { return [string]$cfg.android.package }
    }
  } catch { }

  # Fallback: try android/app/build.gradle applicationId "..."
  try {
    $gradlePath = "android/app/build.gradle"
    if (Test-Path $gradlePath) {
      $txt = Get-Content $gradlePath -Raw
      if ($txt -match 'applicationId\s+"([^"]+)"') { return $matches[1] }
    }
  } catch { }

  return $null
}

function Ensure-AdbDevices([string[]]$serials) {
  $a = @("start-server")
  Adb @a | Out-Null
  $a = @("devices")
  $list = (Adb @a) -join "`n"
  foreach ($s in $serials) {
    if ($list -notmatch [regex]::Escape($s)) {
      throw "ADB device not found: $s`n`nADB devices:`n$list"
    }
  }
}

function Gradle-TasksText {
  $gradleDir = Join-Path (Get-Location) "android"
  $gradlew = Join-Path $gradleDir "gradlew.bat"
  if (-not (Test-Path $gradlew)) { throw "Missing $gradlew. Are you in repo root?" }
  try {
    Push-Location $gradleDir
    $result = & $gradlew ":app:tasks" "--all" "--quiet" 2>$null
    Pop-Location
    return $result
  } catch {
    try { Pop-Location } catch {}
    return ""
  }
}

function Run-Gradle([string]$GradleArgs) {
  $gradleDir = Join-Path (Get-Location) "android"
  $gradlew = Join-Path $gradleDir "gradlew.bat"
  Write-Host "[GRADLE] $GradleArgs"
  Push-Location $gradleDir
  & $gradlew @($GradleArgs.Split(" "))
  $code = $LASTEXITCODE
  Pop-Location
  if ($code -ne 0) { throw "Gradle failed: $GradleArgs" }
}

function Find-DebugApk {
  $primary = "android/app/build/outputs/apk/debug/app-debug.apk"
  if (Test-Path $primary) { return (Resolve-Path $primary).Path }

  $fallback = Get-ChildItem -Path "android/app/build/outputs/apk" -Recurse -File -ErrorAction SilentlyContinue `
    | Where-Object { $_.Name -match 'debug\.apk$' } `
    | Sort-Object LastWriteTime -Descending `
    | Select-Object -First 1

  if ($fallback) { return $fallback.FullName }
  throw "Could not locate debug APK under android/app/build/outputs/apk."
}

function Install-Apk([string]$serial, [string]$apkPath) {
  Write-Host "[INSTALL][$serial] adb install -r -d \"$apkPath\""
  $a = @("-s",$serial,"install","-r","-d",$apkPath)
  $ok = Invoke-AdbWithTimeout -AdbArgs $a -TimeoutMs 240000 -ThrowOnTimeout
  if (-not $ok) { throw "adb install failed/timed out for $serial" }
}

# ---- MAIN ----
if (-not (Test-Path "package.json")) { throw "Run this from repo root (package.json not found)." }

Assert-Cmd "node"
Assert-Cmd "npx"
Ensure-AdbDevices @($HostSerial, $ViewerSerial)

$pm = Get-PackageManager
Install-Deps $pm

if (-not $SkipTypecheck) {
  Write-Host "[TYPECHECK]"
  if ($pm -eq "pnpm") {
    if (-not $pnpmExe) { throw "Missing dependency: 'pnpm' not found in PATH." }
    & $pnpmExe run typecheck
  }
  elseif ($pm -eq "yarn") {
    if (-not $yarnExe) { throw "Missing dependency: 'yarn' not found in PATH." }
    & $yarnExe typecheck
  }
  else {
    if (-not $npmExe) { throw "Missing dependency: 'npm' not found in PATH." }
    & $npmExe run typecheck
  }
}

$pkg = Get-ExpoAndroidPackageId
if ($pkg) {
  Write-Host "[PKG] android.package = $pkg"
  if (-not $NoUninstall) {
    foreach ($s in @($HostSerial, $ViewerSerial)) {
      Write-Host "[UNINSTALL][$s] $pkg (best-effort)"
      $a = @("-s",$s,"uninstall",$pkg)
      $null = Invoke-AdbWithTimeout -AdbArgs $a -TimeoutMs 25000
    }
  }
} else {
  Write-Host "[PKG] android.package not resolved (continuing)."
}

# Avoid Gradle clean (this is what triggered your CMake/codegen failures).
# Instead: delete build outputs and rebuild.
if (Test-Path "android/app/build") {
  Write-Host "[CLEAN] Removing android/app/build (no Gradle clean)"
  Remove-Item -Recurse -Force "android/app/build"
}

# If codegen tasks exist, run them explicitly (harmless if they don’t).
$tasks = Gradle-TasksText
if ($tasks -match "generateCodegenArtifactsFromSchema") {
  Run-Gradle ":app:generateCodegenArtifactsFromSchema"
}

# Build APK once
Run-Gradle ":app:assembleDebug"

$apk = Find-DebugApk
Write-Host "[APK] $apk"

# Install onto BOTH devices by serial (deterministic)
Install-Apk $HostSerial $apk
Install-Apk $ViewerSerial $apk

Write-Host ""
Write-Host "DONE:"
Write-Host "  APK: $apk"
Write-Host "  Host: $HostSerial"
Write-Host "  Viewer: $ViewerSerial"
