RAIL_V1_GOLDEN
- BUILD_RELEASE_APK.ps1: builds release APK with absolute log path + NODE_ENV=production
- VERIFY_APK.ps1: proves manifest + scans for loopback markers; allowlists known Sentry localhost source-path hit
- INSTALL_APK_ALL_DEVICES.ps1: installs APK on all authorized devices + proves versionCode/versionName

Usage:
  pwsh -File .\BUILD_RELEASE_APK.ps1
  pwsh -File .\VERIFY_APK.ps1
  pwsh -File .\INSTALL_APK_ALL_DEVICES.ps1
