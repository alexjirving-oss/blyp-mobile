# IVS Real-Time Local Stage Setup (Blyp)

This guide walks you through setting up and running Blyp's local IVS backend for real-time streaming development.

## Quick Start (5 minutes)

### Step 1 – Create a Stage in AWS (one time)

Run this command to create a new IVS Real-Time Stage:

```powershell
aws ivs-realtime create-stage --name blyp-dev --region us-east-1
```

From the JSON output, copy the `stageArn`. It will look like:
```
arn:aws:ivs:us-east-1:123456789012:stage/AbCdEfGhIjKl
```

### Step 2 – Configure AWS Credentials

Edit `.env.ivs-local` in the repo root and fill in:

```env
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
IVS_STAGE_ARN=arn:aws:ivs:us-east-1:123456789012:stage/AbCdEfGhIjKl
IVS_DEV_BYPASS=
```

> **Important**: Make sure `.env.ivs-local` is in `.gitignore` (it is by default). Never commit real AWS credentials.

### Step 3 – Start the Local IVS Backend

In PowerShell, run one of:

**Option A: Using dotenv (if installed):**
```powershell
npm install dotenv
node -r dotenv/config local-ivs-server.js
```

**Option B: Inline environment variables:**
```powershell
$env:AWS_ACCESS_KEY_ID='AKIA...'
$env:AWS_SECRET_ACCESS_KEY='...'
$env:AWS_REGION='us-east-1'
$env:IVS_STAGE_ARN='arn:aws:ivs:us-east-1:...'
$env:IVS_DEV_BYPASS=''
node local-ivs-server.js
```

**Expected output:**
```
======================================================================
🚀 Local IVS Backend Server
======================================================================
   Port: 3001
   Region: us-east-1
   Stage ARN: arn:aws:ivs:us-east-1:123456789012:stage/AbCdEfGhIjKl

✅ [IVS_LOCAL] Real IVS tokens: ENABLED
   AWS credentials: set
   AWS SDK: loaded
   Stage ARN: arn:aws:ivs:us-east-1:123456789012:stage/AbCdEfGhIjKl
======================================================================
```

### Step 4 – Start Metro WITHOUT Dev Bypass

Open a new PowerShell window and run:

```powershell
$env:EXPO_PUBLIC_API_BASE_URL='http://192.168.1.236:3001'
$env:EXPO_PUBLIC_STREAMING_BACKEND='IVS'
npx expo start --dev-client --clear
```

**Note**: Do NOT set `EXPO_PUBLIC_IVS_DEV_BYPASS=1`. We want real tokens from the backend.

### Step 5 – Test Go Live

1. Open Blyp dev build on device (Galaxy Z Fold)
2. Go to Live tab, host mode
3. Tap **Go Live**
4. Enter a title (e.g., "Test Stream")
5. Tap **Start**

**Expected flow in app logs:**
```
[IVS_API][CONFIG] {"API_BASE_URL": "✓ set", "DEV_BYPASS_ENABLED": false}
[IVS_API][HOST_START] {"bypass": false}
[IVS_API][HOST_START] Got token, calling API...
[IVS_HOST][TOKEN_RECEIVED] {"stageArn": "arn:aws:ivs:us-east-1:...", "streamId": "stream-..."}
[IVS_CLIENT] Starting host session
[IVS_STAGE] Connection state: CONNECTING
[IVS_STAGE] Connection state: CONNECTED  ← Success!
[IVS_STAGE] Participant joined: id=..., local=true
```

**Expected output in backend server:**
```
[HOST_START] Received request
[HOST_START] Decoded user: blyp
[HOST_START] ✓ Success - returning token for user blyp (issued by: aws)
```

## Environment Variables

| Variable | Required | Example | Notes |
|----------|----------|---------|-------|
| `AWS_ACCESS_KEY_ID` | Yes | `AKIA...` | IAM user access key |
| `AWS_SECRET_ACCESS_KEY` | Yes | `...` | IAM user secret |
| `AWS_REGION` | Yes | `us-east-1` | Must match Stage region |
| `IVS_STAGE_ARN` | Yes | `arn:aws:ivs:...` | Output from `create-stage` |
| `IVS_DEV_BYPASS` | No | (empty) | Set to `1` to use mock tokens (dev only) |
| `AWS_SESSION_TOKEN` | No | (empty) | Only needed for temporary credentials |

## Troubleshooting

### Backend shows "Real IVS tokens: DISABLED (fallback to mock)"

Check these in order:

1. **AWS credentials missing?**
   ```powershell
   Write-Host $env:AWS_ACCESS_KEY_ID
   Write-Host $env:AWS_SECRET_ACCESS_KEY
   ```
   Both must be set and non-empty.

2. **Stage ARN missing?**
   ```powershell
   Write-Host $env:IVS_STAGE_ARN
   ```
   Should be `arn:aws:ivs:REGION:ACCOUNT:stage/STAGEID`.

3. **AWS SDK not installed?**
   ```powershell
   npm install @aws-sdk/client-ivs-realtime
   ```

4. **IVS_DEV_BYPASS=1 set?**
   Remove it or set to empty:
   ```powershell
   $env:IVS_DEV_BYPASS=''
   ```

### App still says "connecting" forever

1. **Confirm backend logs "Real IVS tokens: ENABLED"**
2. **Confirm app logs show `issuedBy: "aws"`** (not `mock`)
3. **Check Metro logs for `[IVS_API][CONFIG]` — bypass must be `false`**
4. **Verify Stage ARN region matches AWS_REGION** (e.g., both `us-east-1`)
5. **Check AWS permissions**: IAM user must have `ivs:CreateParticipantToken` on the Stage

### "ECONNREFUSED" on 192.168.1.236:3001

- Backend not running? Start it first.
- Wrong IP? Use your actual LAN IP:
  ```powershell
  ipconfig | findstr "IPv4 Address"
  ```
  Then update `EXPO_PUBLIC_API_BASE_URL=http://<YOUR_IP>:3001`

### "Missing Authorization header"

- App not passing Cognito token? Check `getCognitoJwtForApi.ts`
- For local dev, the server accepts any Bearer token

## Key Files

| File | Purpose |
|------|---------|
| `.env.ivs-local` | Local config (credentials + Stage ARN) |
| `local-ivs-server.js` | Token provisioning server |
| `src/api/ivsLiveApi.ts` | JS API client (calls backend) |
| `src/live/ivs/hooks/useIVSHostSession.ts` | React hook orchestrating flow |
| `android/.../IVSBroadcastModule.kt` | Native Stage integration |

## Next Steps

Once you have a successful connection:

1. **Test multi-participant**: Invite another user to the stage as guest
2. **Implement viewer path**: Distribute playback URL for watchers
3. **Production backend**: Move token signing to AWS Lambda + API Gateway
4. **CI/CD**: Automate Stage ARN rotation, add monitoring

## Further Reading

- [AWS IVS Real-Time Documentation](https://docs.aws.amazon.com/ivs/latest/RealTimeUserGuide/what-is-IVS.html)
- [IVS Real-Time Android Samples](https://github.com/aws-samples/amazon-ivs-real-time-streaming-android-samples)
- [IVS Pricing](https://aws.amazon.com/ivs/pricing/)
