$ErrorActionPreference="Stop"
$PSNativeCommandUseErrorActionPreference=$false
Set-Location C:\Users\Alex\Blyp26

if((git status --porcelain).Length -ne 0){ throw "DIRTY_TREE" }

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$pkt = "diagnostics\rail_v1\BUILD_APK_V2_$ts"
New-Item -ItemType Directory -Force -Path $pkt | Out-Null

function W($name, $lines){
  $p = Join-Path $pkt $name
  $lines | Out-File -Encoding utf8 $p
  $p
}

@(
  "ROOT=$((Get-Location).Path)"
  "BRANCH=$(git rev-parse --abbrev-ref HEAD)"
  "COMMIT=$(git rev-parse HEAD)"
  "LAST_COMMIT=$(git log -1 --pretty=oneline)"
) | Out-File -Encoding utf8 (Join-Path $pkt "01_repo_state.txt")

if(Test-Path .\android\app\build\outputs\apk\release){ Remove-Item -Recurse -Force .\android\app\build\outputs\apk\release }

$env:NODE_ENV="production"

$logAbs = (Resolve-Path $pkt).Path + "\02_build_log.txt"

Push-Location .\android
.\gradlew assembleRelease --no-daemon --stacktrace --info 2>&1 | Tee-Object -FilePath $logAbs
$exit = $LASTEXITCODE
Pop-Location

if($exit -ne 0){
  W "00_summary.txt" @("RESULT=FAIL","EXIT_CODE=$exit","PACKET_DIR=$(Resolve-Path $pkt)")
  throw "BUILD_FAILED_EXIT_$exit"
}

$apk = "android\app\build\outputs\apk\release\app-release.apk"
if(-not (Test-Path $apk)){ throw "APK_NOT_FOUND" }

W "03_apk_info.txt" @(
  "APK=$((Resolve-Path $apk).Path)"
  "SIZE_BYTES=$((Get-Item $apk).Length)"
  "SHA256=$((Get-FileHash $apk -Algorithm SHA256).Hash)"
) | Out-Null

W "00_summary.txt" @("RESULT=PASS","PACKET_DIR=$((Resolve-Path $pkt).Path)","APK=$((Resolve-Path $apk).Path)")
Get-Content (Join-Path $pkt "00_summary.txt")
