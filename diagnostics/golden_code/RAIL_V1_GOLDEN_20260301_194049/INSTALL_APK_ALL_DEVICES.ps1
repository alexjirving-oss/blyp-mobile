$ErrorActionPreference="Stop"
Set-Location C:\Users\Alex\Blyp26

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$pkt = "diagnostics\rail_v1\INSTALL_APK_$ts"
New-Item -ItemType Directory -Force -Path $pkt | Out-Null

function W($name, $lines){
  $p = Join-Path $pkt $name
  $lines | Out-File -Encoding utf8 $p
  $p
}

$apk = "android\app\build\outputs\apk\release\app-release.apk"
if(-not (Test-Path $apk)){ throw "APK_NOT_FOUND" }
$apkAbs = (Resolve-Path $apk).Path

$raw = adb devices
$lines = ($raw | Select-Object -Skip 1) | Where-Object { $_ -match "\S" }
$devs = @()
foreach($l in $lines){
  $p = $l -split "\s+"
  if($p.Length -ge 2 -and $p[1] -eq "device"){ $devs += $p[0] }
}
if($devs.Count -eq 0){ throw "NO_AUTHORIZED_DEVICES" }

W "01_adb_devices.txt" (@("=== adb devices ===") + $raw) | Out-Null

$prove = @()
foreach($d in $devs){
  $prove += "=== DEVICE=$d INSTALL ==="
  $prove += (adb -s $d install -r -d $apkAbs 2>&1)
  $prove += "=== DEVICE=$d VERSION ==="
  $ds = adb -s $d shell dumpsys package com.blyp.mobile 2>&1
  $prove += ($ds | Select-String -Pattern "versionCode=|versionName=" | ForEach-Object { $_.Line.Trim() })
  $prove += ""
}

W "02_install_proof.txt" $prove | Out-Null
W "00_summary.txt" @("RESULT=PASS","PACKET_DIR=$((Resolve-Path $pkt).Path)","APK=$apkAbs","DEVICES=$($devs -join ',')")
Get-Content (Join-Path $pkt "00_summary.txt")
