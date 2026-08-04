# IVS Local Backend Wiring - Summary

**Date**: December 9, 2025  
**Task**: Wire local IVS backend to use real AWS IVS Real-Time tokens and remove dev bypass for normal development flow  
**Status**: ✅ Complete

## Files Modified

### 1. `.env.ivs-local`
- **What**: Standardized environment configuration file
- **Changes**:
  - Changed `IVS_REALTIME_STAGE_ARN` → `IVS_STAGE_ARN` (matches server code)
  - Added clear 4-step instructions at top
  - Added `IVS_DEV_BYPASS` (empty by default) for optional bypass
  - Added explicit usage examples (dotenv vs inline PowerShell)
  - Clarified expected output when real tokens enabled

### 2. `local-ivs-server.js`
- **What**: Local token provisioning backend
- **Changes**:
  - Added optional dotenv loading (`require('dotenv').config()`)
  - Refactored config to read from standardized env vars:
    - `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`
    - `IVS_STAGE_ARN`, `IVS_DEV_BYPASS`
  - Added comprehensive startup logging that clearly reports:
    - ✅ Real IVS tokens: ENABLED (with details)
    - ⚠️ Real IVS tokens: DISABLED (with reasons why)
  - Updated response to include `issuedBy` field ('aws' | 'mock' | 'mock-fallback')
  - Added Stage ARN validation before token generation

### 3. `docs/IVS_LOCAL_SETUP.md` (NEW)
- **What**: Complete developer guide for local IVS setup
- **Contents**:
  - Quick Start (5 minutes) with exact commands
  - Step-by-step walkthrough: AWS Stage creation → config → backend start → Metro start → test
  - Environment variable reference table
  - Comprehensive troubleshooting section
  - Key files reference

## Environment Variable Mapping

| Component | Variable | Default | Notes |
|-----------|----------|---------|-------|
| Backend Server | `AWS_REGION` | `us-east-1` | AWS region hosting Stage |
| Backend Server | `AWS_ACCESS_KEY_ID` | (required) | IAM access key |
| Backend Server | `AWS_SECRET_ACCESS_KEY` | (required) | IAM secret key |
| Backend Server | `AWS_SESSION_TOKEN` | (optional) | For temporary credentials |
| Backend Server | `IVS_STAGE_ARN` | (required for real) | Stage ARN from AWS |
| Backend Server | `IVS_DEV_BYPASS` | (empty/false) | Set to `1` to force mock tokens |
| Metro / JS | `EXPO_PUBLIC_API_BASE_URL` | (required) | Backend URL, e.g. `http://192.168.1.236:3001` |
| Metro / JS | `EXPO_PUBLIC_STREAMING_BACKEND` | (optional) | Set to `IVS` for IVS backend |
| Metro / JS | `EXPO_PUBLIC_IVS_DEV_BYPASS` | (empty/false) | Do NOT set for real token flow |

## Default Behavior (Production Dev Flow)

### Without any bypass flags:

**Backend starts:**
```
🚀 Local IVS Backend Server
...
✅ [IVS_LOCAL] Real IVS tokens: ENABLED
   AWS credentials: set
   AWS SDK: loaded
   Stage ARN: arn:aws:ivs:us-east-1:...
```

**Metro starts (no bypass):**
```
$env:EXPO_PUBLIC_API_BASE_URL='http://192.168.1.236:3001'
$env:EXPO_PUBLIC_STREAMING_BACKEND='IVS'
# (NO IVS_DEV_BYPASS)
npx expo start --dev-client --clear
```

**App logs when going live:**
```
[IVS_API][CONFIG] {"API_BASE_URL": "✓ set", "DEV_BYPASS_ENABLED": false}
[IVS_API][HOST_START] {"bypass": false}
[IVS_HOST][TOKEN_RECEIVED] {"stageArn": "arn:aws:ivs:us-east-1:...", "issuedBy": "aws"}
[IVS_STAGE] Connection state: CONNECTING
[IVS_STAGE] Connection state: CONNECTED  ← SUCCESS
```

## Safety & Security

✅ **Checked**:
- `.env.ivs-local` is in `.gitignore` (no credentials leaked)
- Backend only uses env vars (no hard-coded keys)
- AWS SDK properly configured with credentials
- Dev bypass flag requires explicit `IVS_DEV_BYPASS=1` to enable (off by default)
- Production builds will still reject bypass flag

## Testing Checklist for Alex

When implementing these changes, verify:

- [ ] `.env.ivs-local` updated with real AWS credentials + Stage ARN
- [ ] Backend starts with `✅ [IVS_LOCAL] Real IVS tokens: ENABLED`
- [ ] Metro starts without `EXPO_PUBLIC_IVS_DEV_BYPASS` flag
- [ ] App logs show `DEV_BYPASS_ENABLED: false`
- [ ] App logs show token `issuedBy: "aws"`
- [ ] Connection state: `idle → connecting → connected`
- [ ] See Stage participant join event in logcat

## Next Steps (If Issues Arise)

If the connection still times out at "connecting" after implementing:

1. Verify Stage ARN region matches `AWS_REGION` env var
2. Check IAM permissions: user needs `ivs:CreateParticipantToken`
3. Confirm backend console shows real token issued (not mock fallback)
4. Check firewall: `curl http://192.168.1.236:3001/health` from device
5. Verify app actually fetches from backend (not using local mock)

## Key Contracts Preserved

✅ No JS/TS contracts changed  
✅ No Android native contracts changed  
✅ ivsLiveApi.ts behavior unchanged (bypass still works if explicitly enabled)  
✅ useIVSHostSession hook unchanged  
✅ IVSNativeClient unchanged  
✅ All existing error handling preserved  

## Summary

The local IVS backend is now wired for **real AWS token generation** with:
- Clear env var standardization
- Comprehensive mode reporting (real vs mock)
- Production-safe dev bypass (off by default)
- Complete developer documentation
- Backward compatible (mock still available if needed)

**Default development workflow**: Backend + Metro with real AWS tokens (no bypass).
