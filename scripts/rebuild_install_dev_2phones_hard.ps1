param(
  [Parameter(Mandatory=$true)][string]$HostSerial,
  [Parameter(Mandatory=$true)][string]$ViewerSerial
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Assert-Exists($p, $msg){ if(-not (Test-Path $p)){ throw $msg } }
function Run($cmd){
  Write-Host ">> $cmd"
  cmd /c $cmd
  if($LASTEXITCODE -ne 0){ throw "Command failed ($LASTEXITCODE): $cmd" }
}

$Root = (Resolve-Path ".").Path
Write-Host "ROOT: $Root"

# 0) Sanity: devices present
Run "adb devices"
$devs = (adb devices) | Out-String
if($devs -notmatch [regex]::Escape($HostSerial)){ throw "Host device not detected: $HostSerial" }
if($devs -notmatch [regex]::Escape($ViewerSerial)){ throw "Viewer device not detected: $ViewerSerial" }

# 1) Hard clean (fixes missing codegen jni dirs after a clean)
$pathsToRemove = @(
  "node_modules",
  "android\.gradle",
  "android\build",
  "android\app\build",
  "android\.cxx",
  "android\app\.cxx",
  "android\app\src\main\jni",
  "android\app\src\main\generated"
)

foreach($rel in $pathsToRemove){
  $p = Join-Path $Root $rel
  if(Test-Path $p){
    Write-Host "Removing: $p"
    Remove-Item -Recurse -Force $p
  }
}

# 2) Install deps (prefer npm ci if lockfile exists)
Assert-Exists (Join-Path $Root "package.json") "package.json not found in repo root"
if(Test-Path (Join-Path $Root "package-lock.json")){
  Run "npm ci"
} else {
  Run "npm install"
}

# 3) Force RN/Gradle to regenerate codegen + autolinking before native build
Push-Location (Join-Path $Root "android")
Assert-Exists ".\gradlew.bat" "android\gradlew.bat not found"

# Clean + generate codegen/autolink artifacts (tasks exist in RN new-arch builds)
Run ".\gradlew.bat --no-daemon clean"

# Try the most common codegen/autolink tasks; ignore if a task name doesn't exist
$maybeTasks = @(
  ":app:generateCodegenArtifactsFromSchema",
  ":app:generateAutolinkingPackageList",
  ":app:generatePackageList"
)

foreach($t in $maybeTasks){
  try {
    Run ".\gradlew.bat --no-daemon $t"
  } catch {
    Write-Host "Skipping missing task: $t"
  }
}

# 4) Build debug APK
Run ".\gradlew.bat --no-daemon :app:assembleDebug --stacktrace"
Pop-Location

# 5) Install on BOTH devices
$apk = Join-Path $Root "android\app\build\outputs\apk\debug\app-debug.apk"
Assert-Exists $apk "APK not found at: $apk"

Run "adb -s $HostSerial install -r -d `"$apk`""
Run "adb -s $ViewerSerial install -r -d `"$apk`""

Write-Host ""
Write-Host "✅ DONE. Installed debug build on:"
Write-Host "   HOST:   $HostSerial"
Write-Host "   VIEWER: $ViewerSerial"
Write-Host ""
