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
Copy-Item -Force $exe (Join-Path $destDir "BlypTikTokCompanion-win.exe")
Copy-Item -Force (Join-Path $here "dist\companion.cjs") (Join-Path $destDir "companion.cjs")

Get-Item $exe | Select-Object FullName, Length, LastWriteTime
Write-Host "Copied to $destDir"
