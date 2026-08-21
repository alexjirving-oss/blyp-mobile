# Build a double-click Windows helper for Blyp Live Studio TikTok auto-connect.
# Uses Node SEA: copy node.exe, inject bundled companion.cjs.
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

if (-not (Test-Path "node_modules")) {
  npm install
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

npm run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

npx --yes esbuild dist/main.js --bundle --platform=node --format=cjs --outfile=dist/companion.cjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$nodeExe = (Get-Command node).Source
$fuseMatch = Select-String -Path $nodeExe -Pattern "NODE_SEA_FUSE_[0-9a-f]{32}" -Encoding byte -ErrorAction SilentlyContinue
# Binary search via findstr is more reliable on Windows PE
$fuseLine = cmd /c "findstr /C:NODE_SEA_FUSE `"$nodeExe`""
if ($fuseLine -notmatch "NODE_SEA_FUSE_[0-9a-f]{32}") {
  # Node 22.20 nvm build uses a slightly different fuse than the docs default.
  $fuse = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"
} else {
  $fuse = $Matches[0]
}

Write-Host "SEA fuse: $fuse"

$seaConfig = Join-Path $here "dist\sea-config.json"
@{
  main = "companion.cjs"
  output = "sea-prep.blob"
  disableExperimentalSEAWarning = $true
} | ConvertTo-Json | Set-Content -Path $seaConfig -Encoding ASCII

Push-Location (Join-Path $here "dist")
node --experimental-sea-config "sea-config.json"
if ($LASTEXITCODE -ne 0) {
  Pop-Location
  exit $LASTEXITCODE
}
Pop-Location

$blob = Join-Path $here "dist\sea-prep.blob"
$exe = Join-Path $here "dist\BlypTikTokCompanion.exe"
Copy-Item -Force $nodeExe $exe

npx --yes postject $exe NODE_SEA_BLOB $blob --sentinel-fuse $fuse --overwrite
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
if (-not (Test-Path $exe)) {
  Write-Error "SEA did not write $exe"
  exit 1
}

$destDir = Join-Path $here "..\..\apps\blyp-world\public\downloads"
New-Item -ItemType Directory -Force -Path $destDir | Out-Null
$destExe = Join-Path $destDir "BlypTikTokCompanion-win.exe"
Copy-Item -Force $exe $destExe

# Optional Authenticode. There is no org code-signing cert in this repo or the
# local cert stores. Chrome / SmartScreen WILL keep warning until a paid OV/EV
# Authenticode cert signs this file and reputation builds. Self-signed is worse.
$pfx = $env:BLYP_WIN_CODESIGN_PFX
$signed = $false
if ($pfx) {
  if (-not (Test-Path $pfx)) {
    Write-Error "BLYP_WIN_CODESIGN_PFX is set but the file does not exist."
    exit 1
  }
  $signTool = $null
  $cmd = Get-Command signtool -ErrorAction SilentlyContinue
  if ($cmd) { $signTool = $cmd.Source }
  if (-not $signTool) {
    $kit = Get-ChildItem "C:\Program Files (x86)\Windows Kits\10\bin" -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -match '\\x64\\signtool\.exe$' } |
      Sort-Object FullName -Descending |
      Select-Object -First 1
    if ($kit) { $signTool = $kit.FullName }
  }
  if (-not $signTool) {
    Write-Error "signtool.exe not found. Install the Windows SDK, or unset BLYP_WIN_CODESIGN_PFX."
    exit 1
  }
  $timestampUrl = "http://timestamp.digicert.com"
  $pfxPass = $env:BLYP_WIN_CODESIGN_PFX_PASSWORD
  if ($pfxPass) {
    & $signTool sign /fd SHA256 /td SHA256 /tr $timestampUrl /f $pfx /p $pfxPass $destExe
  } else {
    & $signTool sign /fd SHA256 /td SHA256 /tr $timestampUrl /f $pfx $destExe
  }
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  Copy-Item -Force $destExe $exe
}

$auth = Get-AuthenticodeSignature -FilePath $destExe
$signed = ($auth.Status -eq "Valid")
if (-not $signed) {
  Write-Host "UNSIGNED ($($auth.Status)). Chrome Safe Browsing and SmartScreen will warn until a paid Authenticode cert is used. Do not treat page copy as a Chrome fix."
}

$hash = (Get-FileHash -Algorithm SHA256 -Path $destExe).Hash.ToUpperInvariant()
$hash | Set-Content -Path (Join-Path $destDir "BlypTikTokCompanion-win.exe.sha256") -Encoding ASCII
$bytes = (Get-Item $destExe).Length
$metaPath = Join-Path $here "..\..\apps\blyp-world\lib\tiktokCompanionRelease.json"
$meta = @"
{
  "fileName": "BlypTikTokCompanion-win.exe",
  "downloadPath": "/downloads/BlypTikTokCompanion-win.exe",
  "sha256": "$hash",
  "bytes": $bytes,
  "signed": $($signed.ToString().ToLowerInvariant())
}
"@
Set-Content -Path $metaPath -Value $meta.Trim() -Encoding ASCII

$readme = @"
Blyp TikTok Companion (Windows)

1. Chrome will warn because this helper is not yet Microsoft-signed.
   Click Keep / Download suspicious file — not Delete from history.
2. Run BlypTikTokCompanion-win.exe and leave the window open. Do not use npm.
3. Return to https://blyp.world/live/studio and click Connect TikTok.

SHA-256 $hash
This helper is a loopback server (127.0.0.1:8765). It reads TikTok LIVE Studio
RTMP Server URL + Stream key on this PC. It does not sign into TikTok.
"@
Set-Content -Path (Join-Path $destDir "README.txt") -Value $readme.Trim() -Encoding ASCII

Get-Item $destExe | Select-Object FullName, Length, LastWriteTime
Write-Host "SHA-256 $hash"
Write-Host "Copied to $destDir (signed=$signed)"
