# Live Broadcast Test Procedure (2 Phones)

## Goal
Verify IVS Real-Time host can start and viewer can render the live.

## Pre-reqs
- Two Android phones connected via USB.
- Backend reachable from phones (EXPO_PUBLIC_API_BASE_URL points to LAN IP + port).
- Dev auto-login is active (uid=test / authReady true).

## How to run
PowerShell from repo root:

- Normal run:
  powershell -ExecutionPolicy Bypass -File scripts\live_broadcast_test_procedure_2phones.ps1

- Force reinstall on both phones:
  powershell -ExecutionPolicy Bypass -File scripts\live_broadcast_test_procedure_2phones.ps1 -Install

## Pass/Fail Gates

### Host PASS requires all:
- TOKEN_RECEIVED
- NATIVE_CALL_READY
- native startHostSession / START_HOST_SESSION
- STAGE_CREATE
- LOCAL_JOINED

### Viewer PASS requires all:
- SURFACE_READY
- TOKEN (viewer)
- joinAsViewer
- REMOTE_VIDEO
- FIRST_FRAME

If Host fails, Viewer cannot pass. Fix host first.

## What to paste back
From logs/:
- last ~120 lines of live_test_host_*.log
- last ~120 lines of live_test_viewer_*.log
