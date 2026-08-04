# Blyp launcher usage

All commands assume you run from repo root (e.g. `C:\Users\Alex\369369369`).

## Start services
Starts backend (port 4000) + Metro (port 8081/19000/19001) using the existing helper.

```powershell
powershell -NoLogo -ExecutionPolicy Bypass -File .\scripts\blyp.ps1 -Mode services
```

## Start live (2 phones)
Spawns backend + Metro + 2x logcat capture windows. Defaults:
- HostSerial: `R5CX71NM1RK`
- ViewerSerial: `RFCY71ZFS6F`
- KeepAliveMinutes: 45
- UseAdbReverse: ON
- ClearDeviceLogs: ON

```powershell
powershell -NoLogo -ExecutionPolicy Bypass -File .\scripts\blyp.ps1 -Mode live
```

## Start e2e (skip build)
Runs the existing E2E proof flow but standardises run folders.

```powershell
powershell -NoLogo -ExecutionPolicy Bypass -File .\scripts\blyp.ps1 -Mode e2e -SkipBuild
```

## Capture now
Captures logcat dumps + screenshots into the most recent run folder under `.\logs\runs\...`.

```powershell
powershell -NoLogo -ExecutionPolicy Bypass -File .\scripts\blyp.ps1 -Mode capture
```

### Optional capture flags
Wait a timed window and clear logcat before capture:

```powershell
powershell -NoLogo -ExecutionPolicy Bypass -File .\scripts\blyp.ps1 -Mode capture -ClearBefore -Seconds 60
```
