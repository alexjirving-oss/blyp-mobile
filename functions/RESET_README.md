# One-Time Firestore Reset

This directory contains a **dev-only** Cloud Function to wipe all data from Firestore collections for a clean start.

## ⚠️ WARNING

This is a **DESTRUCTIVE** operation. It will delete ALL documents from:
- `users`
- `userProfiles`
- `posts`
- `liveStreams`

## Quick Start

### 1. Deploy the Function

From the `functions/` directory:

```powershell
.\deploy-reset-function.ps1
```

This will:
- Generate a random secret key
- Configure Firebase Functions
- Deploy the `devResetFirestore` function
- Show you the curl command to call it

### 2. Call the Function

Use the curl command shown at the end of deployment, or:

```powershell
$secret = "YOUR_SECRET_KEY_FROM_STEP_1"
$headers = @{ 'x-admin-reset-key' = $secret }
Invoke-WebRequest -Method POST `
  -Uri 'https://us-central1-blyp-610ee.cloudfunctions.net/devResetFirestore' `
  -Headers $headers | Select-Object -ExpandProperty Content
```

### 3. Verify Reset

Check Firebase Console → Firestore Database - collections should be empty.

### 4. Clean Up (IMPORTANT!)

After successful reset:

```powershell
.\cleanup-reset-function.ps1
```

This removes the function from your Firebase project so it can't be accidentally called again.

## Safety Features

- ✅ **Environment Check**: Refuses to run if `BLYP_ENV` or `NODE_ENV` is "production"
- ✅ **Secret Key**: Requires matching `x-admin-reset-key` header
- ✅ **Batch Processing**: Deletes in safe 400-doc batches
- ✅ **Comprehensive Logging**: All actions logged with `[DEV_RESET]` prefix

## Troubleshooting

**Function returns 403 Forbidden:**
- Check that your secret key matches
- Verify environment is not set to "production"

**Function times out:**
- Normal for large datasets (up to 9 minutes allowed)
- Check Firebase Functions logs: `firebase functions:log`

**Want to see logs:**
```powershell
firebase functions:log --only devResetFirestore
```
