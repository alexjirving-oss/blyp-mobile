RAIL_V2_AUTOCAPTURE_GOLDEN

Scripts:
  1) RUN_AUTOCAPTURE.ps1
     - Installs release APK on all authorized devices (unless -NoInstall)
     - Launches app
     - Captures PID-scoped logcat per device (reliable evidence)
     - Pulls tombstones + dropbox entries (crash/anr if present)
     - Captures bugreport per device
     - Writes run packet under: diagnostics\rail_v2\AUTOCAPTURE_<ts>\

Usage:
  pwsh -File .\RUN_AUTOCAPTURE.ps1 -Seconds 60
  pwsh -File .\RUN_AUTOCAPTURE.ps1 -Seconds 120 -NoInstall

Notes:
  - No login, no go-live, no manual steps.
  - This rail is about evidence capture + reproducibility.
