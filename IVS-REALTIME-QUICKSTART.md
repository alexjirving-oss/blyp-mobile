# IVS Real-Time Quick Start Guide

## Current Status ✅

Your Android app is **correctly integrated** with IVS Real-Time Stage SDK:
- ✅ Gradle uses `ivs-broadcast:1.37.0:stages@aar` (Stage variant)
- ✅ `IVSBroadcastModule.kt` implements full Stage API with proper listeners
- ✅ JS → Native bridge works (token + stageArn passed correctly)
- ✅ Camera + mic permissions granted
- ✅ Local server can issue real IVS tokens (just installed AWS SDK)

## The Issue 🔍

You're stuck in "connecting" because:
1. `EXPO_PUBLIC_IVS_DEV_BYPASS=1` makes JS use **mock tokens + fake Stage ARN**
2. Native tries to join `arn:aws:ivs:dev-local:stage/1765209265129` (doesn't exist on AWS)
3. AWS rejects it → infinite "connecting"

## The Fix 🛠️

### Step 1: Get Your Real IVS Stage ARN

```bash
# Create a Stage via AWS CLI (or use AWS Console)
aws ivs-realtime create-stage \
  --name "blyp-dev-stage" \
  --region us-east-1

# Output will include:
# "arn": "arn:aws:ivs:us-east-1:ACCOUNT_ID:stage/STAGE_ID"
```

Save that ARN.

### Step 2: Configure Local Backend Server

Edit `.env.ivs-local` and fill in:

```bash
AWS_ACCESS_KEY_ID=AKIA...  # Your IAM access key
AWS_SECRET_ACCESS_KEY=...   # Your IAM secret
AWS_REGION=us-east-1
IVS_REALTIME_STAGE_ARN=arn:aws:ivs:us-east-1:ACCOUNT_ID:stage/STAGE_ID
```

### Step 3: Restart Backend with Real AWS Integration

Kill old server (port 3001), start new one:

```powershell
# Load env vars and start
$env:AWS_ACCESS_KEY_ID='AKIA...'; $env:AWS_SECRET_ACCESS_KEY='...'; $env:AWS_REGION='us-east-1'; $env:IVS_REALTIME_STAGE_ARN='arn:aws:ivs:us-east-1:...'; node local-ivs-server.js
```

You should see:
```
✓ Real IVS tokens: enabled
```

### Step 4: Restart Metro WITHOUT Dev Bypass

```powershell
# REMOVE IVS_DEV_BYPASS flag to force real backend calls
$env:EXPO_PUBLIC_API_BASE_URL='http://192.168.1.236:3001'; $env:EXPO_PUBLIC_STREAMING_BACKEND='IVS'; npx expo start --dev-client --clear
```

### Step 5: Test on Device

1. Reload the app (shake → Reload)
2. Tap Go Live
3. Enter a title
4. Tap Start

Expected logs:
```
[IVS_API][HOST_START] {"bypass": false}
[IVS_API][HOST_START] Got token, calling API...
[IVS_HOST][TOKEN_RECEIVED] {"stageArn": "arn:aws:ivs:us-east-1:...", "streamId": "stream-..."}
[IVS_CLIENT] Starting host session
[IVS_STAGE] Connection state: CONNECTING
[IVS_STAGE] Connection state: CONNECTED  ← SUCCESS!
[IVS_STAGE] Participant joined: local=true
```

## Troubleshooting

### Still seeing "bypass: true"?
- You forgot to remove `EXPO_PUBLIC_IVS_DEV_BYPASS=1` from Metro env vars
- Reload Metro: stop terminal, restart with only `API_BASE_URL` + `STREAMING_BACKEND`

### Backend returns mock token?
- Check server logs for `Real IVS tokens: enabled` vs `mock only`
- Verify AWS env vars are set before starting `node local-ivs-server.js`
- Check IAM permissions: user needs `ivs:CreateParticipantToken`

### Stage.join() fails with "Invalid ARN"?
- Confirm ARN format: `arn:aws:ivs:REGION:ACCOUNT:stage/STAGE_ID`
- Ensure region matches: if stage is `eu-west-1`, set `AWS_REGION=eu-west-1`

### "ECONNREFUSED" when calling backend?
- Backend must be running on 3001 before starting Metro
- Check firewall/network: `curl http://192.168.1.236:3001/health`
- Try `localhost:3001` if testing on same machine

## Next Steps (Once Connected)

1. **Viewer path**: Implement playback URL distribution (Stage → HLS/RTMP)
2. **Guest slots**: Wire `startGuestSession` for multi-host (separate tokens)
3. **Deploy backend**: Move token signing to AWS Lambda + API Gateway
4. **Production**: Replace dev server with real backend; update `EXPO_PUBLIC_API_BASE_URL`

## Key Files

- `local-ivs-server.js` – Token issuer (now supports real AWS signing)
- `android/app/build.gradle` – Contains `:stages@aar` dependency
- `android/.../IVSBroadcastModule.kt` – Native Stage SDK implementation
- `src/api/ivsLiveApi.ts` – JS API wrapper (checks `DEV_BYPASS` flag)
- `src/live/ivs/hooks/useIVSHostSession.ts` – React hook orchestrating flow
