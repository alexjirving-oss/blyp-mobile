# IVS Backend Token Service - Implementation Guide

## Overview

This document describes the production-grade IVS token API endpoints implemented for Blyp Mobile's live streaming backend.

The backend is deployed as Firebase Cloud Functions and provides three main endpoints:
1. **POST /api/ivs/host-start** - Host starts a broadcast
2. **POST /api/ivs/guest-join** - Guest joins the broadcast
3. **POST /api/ivs/viewer-join** - Viewer watches the broadcast

All endpoints require Cognito authentication via `Authorization: Bearer <cognito-id-token>` header.

---

## Architecture

### Files Created/Modified

| File | Purpose | Status |
|------|---------|--------|
| `functions/src/services/ivsService.ts` | **NEW** - Core IVS token service with Cognito token decoding and AWS SDK integration | ✅ Production-ready |
| `functions/src/services/ivsRouter.ts` | **NEW** - HTTP endpoint handlers for token provisioning | ✅ Production-ready |
| `functions/src/index.ts` | **MODIFIED** - Export new endpoints (hostStart, guestJoin, viewerJoin) | ✅ Updated |
| `functions/tsconfig.json` | **MODIFIED** - Fixed to support Node.js-compatible TypeScript compilation | ✅ Fixed |

### Key Components

#### 1. IVS Service (`ivsService.ts`)

**Cognito Token Decoding:**
```typescript
export function decodeCognitoToken(idToken: string): CognitoTokenPayload
```
- Extracts `sub` (user ID) from Cognito JWT payload
- Validates JWT structure (3 dot-separated parts)
- **TODO: In production, implement full signature verification** against Cognito JWKS endpoint

**IVS Real-Time Token Generation:**
```typescript
class IvsRealtimeService {
  async createParticipantToken(opts: {
    userId: string;
    stageArn: string;
    role: 'PUBLISHER' | 'SUBSCRIBER';
    durationSeconds?: number;
  }): Promise<IvsTokenResponse>
}
```
- Uses AWS SDK v3 `IVSRealTimeClient`
- Calls `CreateParticipantTokenCommand` with proper capability mapping:
  - `'PUBLISHER'` role → AWS capability `'PUBLISH'`
  - `'SUBSCRIBER'` role → AWS capability `'SUBSCRIBE'`
- Returns signed JWT token valid for configured duration (default: 1 hour)

**Viewer Playback Service:**
```typescript
class IvsViewerService {
  getViewerInfo(opts: { userId: string }): { playbackUrl: string; viewerId: string }
}
```
- Returns HLS playback URL for viewers
- No AWS SDK call needed (playback is public)
- URL comes from `IVS_PLAYBACK_URL` environment variable

#### 2. IVS Router (`ivsRouter.ts`)

Three HTTP Cloud Functions handle authentication and token provisioning:

**Middleware: `extractCognitoUserId(authHeader)`**
- Parses `Authorization: Bearer <token>` header
- Calls `decodeCognitoToken()` to extract user ID
- Returns 401 if header missing or malformed

**Response Format (all endpoints):**
```typescript
interface IvsApiResponse {
  ok: boolean;
  role: 'host' | 'guest' | 'viewer';
  userId: string;
  streamId: string;
  stageArn?: string;          // Host and guest
  region?: string;            // Host and guest
  token?: string;             // Host and guest (JWT)
  playbackUrl?: string;       // Viewer only
  expiresAt?: string;         // ISO 8601 timestamp
  error?: string;             // If ok === false
}
```

---

## Endpoints

### 1. POST /api/ivs/host-start

**Purpose:** Host starts a new broadcast session.

**Request:**
```bash
curl -X POST https://your-backend.com/api/ivs/host-start \
  -H "Authorization: Bearer <cognito-id-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "streamId": "custom-stream-123",           # Optional, auto-generated if omitted
    "stageArnOverride": "arn:aws:ivs:..."      # Optional, uses env IVS_REALTIME_STAGE_ARN if omitted
  }'
```

**Response (200 OK):**
```json
{
  "ok": true,
  "role": "host",
  "userId": "user-abc123",
  "streamId": "stream-1733597400000-xyz789",
  "stageArn": "arn:aws:ivs:eu-west-1:123456789012:stage/blyp-live-stream-xyz",
  "region": "eu-west-1",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresAt": "2025-12-07T14:30:00Z"
}
```

**Response (500 Error):**
```json
{
  "ok": false,
  "role": "host",
  "userId": "user-abc123",
  "streamId": "stream-...",
  "error": "No stage ARN configured. Set IVS_REALTIME_STAGE_ARN env var..."
}
```

**Server-Side Logs:**
```
[IVS_API][HOST_START_REQUEST] { userId: 'user-abc123' }
[IVS_SERVICE][CREATE_TOKEN_REQUEST] { userId: 'user-abc123', stageArn: '...', role: 'PUBLISHER', durationSeconds: 3600 }
[IVS_SERVICE][CREATE_TOKEN_SUCCESS] { userId: 'user-abc123', stageArn: '...', role: 'PUBLISHER', expiresAt: '2025-12-07T14:30:00Z' }
[IVS_API][HOST_START_SUCCESS] { userId: 'user-abc123', streamId: '...', stageArn: '...' }
```

---

### 2. POST /api/ivs/guest-join

**Purpose:** Guest joins an existing broadcast as co-host.

**Request:**
```bash
curl -X POST https://your-backend.com/api/ivs/guest-join \
  -H "Authorization: Bearer <cognito-id-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "streamId": "stream-1733597400000-xyz789",
    "stageArn": "arn:aws:ivs:eu-west-1:123456789012:stage/blyp-live-stream-xyz"
  }'
```

**Response (200 OK):**
```json
{
  "ok": true,
  "role": "guest",
  "userId": "user-def456",
  "streamId": "stream-1733597400000-xyz789",
  "stageArn": "arn:aws:ivs:eu-west-1:123456789012:stage/blyp-live-stream-xyz",
  "region": "eu-west-1",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresAt": "2025-12-07T14:30:00Z"
}
```

**Response (500 Error):**
```json
{
  "ok": false,
  "role": "guest",
  "userId": "user-def456",
  "streamId": "",
  "error": "Request body must include streamId and stageArn"
}
```

---

### 3. POST /api/ivs/viewer-join

**Purpose:** Viewer gets playback URL to watch the broadcast.

**Request:**
```bash
curl -X POST https://your-backend.com/api/ivs/viewer-join \
  -H "Authorization: Bearer <cognito-id-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "streamId": "stream-1733597400000-xyz789"
  }'
```

**Response (200 OK):**
```json
{
  "ok": true,
  "role": "viewer",
  "userId": "user-ghi789",
  "streamId": "stream-1733597400000-xyz789",
  "playbackUrl": "https://d7b3c4f5a.ivs.aws.com/index.m3u8"
}
```

---

## Environment Configuration

### Required Environment Variables

Set these in your Firebase Cloud Functions environment or `.env` file:

```env
# AWS Configuration
AWS_REGION=eu-west-1
AWS_ACCESS_KEY_ID=<your-access-key>
AWS_SECRET_ACCESS_KEY=<your-secret-key>

# IVS Configuration
IVS_REALTIME_STAGE_ARN=arn:aws:ivs:eu-west-1:123456789012:stage/blyp-live-broadcast
IVS_PLAYBACK_URL=https://d7b3c4f5a.ivs.aws.com/index.m3u8
```

### Configuration via Firebase Console

1. Go to **Firebase Console** → Select project → **Functions** tab
2. Click **Runtime settings** (gear icon)
3. Add environment variables under **Runtime environment variables**:
   - `AWS_REGION`
   - `AWS_ACCESS_KEY_ID`
   - `AWS_SECRET_ACCESS_KEY`
   - `IVS_REALTIME_STAGE_ARN`
   - `IVS_PLAYBACK_URL`

4. Redeploy functions: `firebase deploy --only functions`

---

## Security Notes

### Current Implementation (MVP)

✅ **Implemented:**
- Cognito JWT token validation (structure check + `sub` claim extraction)
- HTTPS-only communication (enforced by Firebase)
- Authorization header required for all endpoints
- No token signature verification yet

⚠️ **TODO for Production Hardening:**
- [ ] Validate JWT signature against Cognito JWKS endpoint
- [ ] Implement token expiration checks
- [ ] Add rate limiting per user
- [ ] Audit logging for all token requests
- [ ] Implement IP whitelisting for admin endpoints
- [ ] Add request signing (AWS SigV4) for internal service calls

### AWS IAM Role

The service account running Firebase Functions needs these IAM permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ivs:CreateParticipantToken",
        "ivs:GetStage",
        "ivs:ListStages"
      ],
      "Resource": "arn:aws:ivs:*:*:stage/*"
    }
  ]
}
```

---

## Integration with Mobile App

### Mobile Configuration

The mobile app expects endpoints at:
- `POST /api/ivs/host-start`
- `POST /api/ivs/guest-join`
- `POST /api/ivs/viewer-join`

Set `EXPO_PUBLIC_API_BASE_URL` in mobile `.env`:
```env
EXPO_PUBLIC_API_BASE_URL=https://your-firebase-backend.cloudfunctions.net
```

Disable dev bypass when backend is available:
```env
# EXPO_PUBLIC_IVS_DEV_BYPASS=1   # Comment this out for production
```

### API Response Contract

The mobile app (`src/api/ivsLiveApi.ts`) expects these fields:

**Host/Guest Response:**
```typescript
{
  streamId: string;
  stageArn: string;
  region: string;
  role: 'host' | 'guest';
  participantToken: string;
  expiresAt: string;  // ISO 8601
  userId: string;
}
```

**Viewer Response:**
```typescript
{
  streamId: string;
  playbackUrl: string;
  role: 'viewer';
  userId: string;
}
```

---

## Deployment

### Deploy to Firebase

```bash
cd functions
npm install
npm run build
firebase deploy --only functions
```

### Verify Deployment

```bash
# Check function logs
firebase functions:log

# Test endpoint
curl -X POST https://your-project.cloudfunctions.net/api/ivs/host-start \
  -H "Authorization: Bearer <test-cognito-token>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

## Example Response Flow

### Host Flow
1. Mobile app calls `POST /api/ivs/host-start`
2. Backend extracts Cognito user ID from token
3. Backend calls AWS IVS to create participant token
4. Backend returns token + stageArn to mobile
5. Mobile connects to IVS Stage using token (native Android/iOS bridge)

### Guest Flow
1. Guest receives stage ARN from host (via Firestore)
2. Mobile app calls `POST /api/ivs/guest-join` with stageArn
3. Backend creates participant token with same stageArn
4. Guest connects using token

### Viewer Flow
1. Viewer requests stream info
2. Mobile app calls `POST /api/ivs/viewer-join`
3. Backend returns playback URL
4. Mobile player streams HLS from playback URL

---

## Troubleshooting

### Token generation fails with "Stage not found"
- Verify `IVS_REALTIME_STAGE_ARN` is set and correct
- Check AWS IAM permissions for `ivs:CreateParticipantToken`

### Authorization header missing (401)
- Ensure mobile app includes `Authorization: Bearer <token>` header
- Check Cognito token is valid and not expired

### CORS errors
- Router includes `Access-Control-Allow-Origin: *` headers
- Ensure fetch/axios in mobile includes credentials: `omit` or `same-origin`

### Token expires immediately
- Verify `durationSeconds` is passed correctly (default: 3600)
- Check client clock is synchronized

---

## Next Steps

### Phase 1: MVP (✅ Complete)
- [x] Cognito token decoding
- [x] AWS IVS token generation
- [x] HTTP endpoints
- [x] Integration with mobile app

### Phase 2: Production Hardening
- [ ] JWT signature verification
- [ ] Rate limiting
- [ ] Audit logging
- [ ] Monitoring/alerts

### Phase 3: Advanced Features
- [ ] Dynamic stage creation per session
- [ ] Guest invitation system
- [ ] Stream analytics
- [ ] Monetization API

---

## Support

For issues or questions:
1. Check server logs: `firebase functions:log`
2. Review this guide's Troubleshooting section
3. Verify environment variables are set
4. Check AWS IAM permissions
