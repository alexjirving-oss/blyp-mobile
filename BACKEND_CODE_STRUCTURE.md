# IVS Backend Implementation - Code Structure

## Quick Reference

### What Was Created

```
functions/
├── src/
│   ├── services/
│   │   ├── ivsService.ts           ← NEW: Core IVS token service
│   │   │   ├── decodeCognitoToken()
│   │   │   ├── IvsRealtimeService class
│   │   │   ├── IvsViewerService class
│   │   │   └── singleton exports
│   │   │
│   │   └── ivsRouter.ts            ← NEW: HTTP endpoints
│   │       ├── extractCognitoUserId()
│   │       ├── hostStart()
│   │       ├── guestJoin()
│   │       └── viewerJoin()
│   │
│   └── index.ts                    ← UPDATED: Export endpoints
│
└── IVS_BACKEND_API.md              ← Full documentation
```

---

## Service Layer: `ivsService.ts`

### Cognito Token Decoding

```typescript
export function decodeCognitoToken(idToken: string): CognitoTokenPayload {
  // JWT structure: <header>.<payload>.<signature>
  const parts = idToken.split('.');
  if (parts.length !== 3) throw Error("Invalid JWT");
  
  // Decode payload (base64url)
  const payloadBase64 = parts[1];
  const payload = Buffer.from(payloadBase64, 'base64').toString('utf8');
  const decoded = JSON.parse(payload);
  
  // Extract user ID
  if (!decoded.sub) throw Error('Missing user ID');
  return decoded;
}
```

### IVS Real-Time Service

```typescript
export class IvsRealtimeService {
  private client: IVSRealTimeClient;
  
  constructor(region: string) {
    this.client = new IVSRealTimeClient({ region });
  }
  
  async createParticipantToken(opts: {
    userId: string;
    stageArn: string;
    role: 'PUBLISHER' | 'SUBSCRIBER';
    durationSeconds?: number;
  }): Promise<IvsTokenResponse> {
    // Map role to AWS capability
    const awsCapability = opts.role === 'PUBLISHER' ? 'PUBLISH' : 'SUBSCRIBE';
    
    // Call AWS IVS
    const response = await this.client.send(
      new CreateParticipantTokenCommand({
        stageArn: opts.stageArn,
        userId: opts.userId,
        capabilities: [awsCapability],
        duration: opts.durationSeconds || 3600,
      })
    );
    
    // Return structured response
    return {
      token: response.participantToken.token,
      stageArn: opts.stageArn,
      region: this.region,
      issuedAt: Date.now(),
      expiresAt: Date.now() + (opts.durationSeconds || 3600) * 1000,
      role: opts.role,
    };
  }
}
```

### Viewer Service

```typescript
export class IvsViewerService {
  private playbackUrl: string;
  
  constructor(playbackUrl: string) {
    this.playbackUrl = playbackUrl;
  }
  
  getViewerInfo(opts: { userId: string }): {
    playbackUrl: string;
    viewerId: string;
  } {
    return {
      playbackUrl: this.playbackUrl,
      viewerId: opts.userId,
    };
  }
}
```

### Singleton Instances

```typescript
export const ivsRealtime = new IvsRealtimeService(process.env.AWS_REGION || 'eu-west-1');
export const ivsViewer = new IvsViewerService(process.env.IVS_PLAYBACK_URL || '');
```

---

## Router Layer: `ivsRouter.ts`

### Middleware

```typescript
function extractCognitoUserId(authHeader: string | undefined): string {
  if (!authHeader) throw new Error('Missing Authorization header');
  
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new Error('Invalid Authorization header format');
  
  const token = match[1];
  const decoded = decodeCognitoToken(token);
  return decoded.sub;
}
```

### Host Start Endpoint

```typescript
export const hostStart = functions.https.onRequest(async (req, res) => {
  // CORS headers
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }
  
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }
  
  try {
    // 1. Extract user ID from Cognito token
    const userId = extractCognitoUserId(req.headers.authorization);
    
    // 2. Get stage ARN
    const stageArn = req.body.stageArnOverride || process.env.IVS_REALTIME_STAGE_ARN;
    if (!stageArn) throw new Error('No stage ARN configured');
    
    // 3. Generate token
    const tokenResponse = await ivsRealtime.createParticipantToken({
      userId,
      stageArn,
      role: 'PUBLISHER',
      durationSeconds: 3600,
    });
    
    // 4. Return response
    res.status(200).json({
      ok: true,
      role: 'host',
      userId,
      streamId: req.body.streamId || `stream-${Date.now()}`,
      stageArn,
      region: tokenResponse.region,
      token: tokenResponse.token,
      expiresAt: new Date(tokenResponse.expiresAt).toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({
      ok: false,
      role: 'host',
      userId: '',
      streamId: '',
      error: message,
    });
  }
});
```

### Guest Join Endpoint

```typescript
export const guestJoin = functions.https.onRequest(async (req, res) => {
  // Similar structure to hostStart
  // Uses `req.body.stageArn` (required)
  // Calls `ivsRealtime.createParticipantToken` with role: 'PUBLISHER'
  // Returns same response format
});
```

### Viewer Join Endpoint

```typescript
export const viewerJoin = functions.https.onRequest(async (req, res) => {
  // Similar structure
  // Calls `ivsViewer.getViewerInfo()` (no AWS call)
  // Returns `{ ok, role, userId, streamId, playbackUrl }`
});
```

---

## Integration: `index.ts`

```typescript
// NEW: Export production IVS endpoints
export { hostStart, guestJoin, viewerJoin } from './services/ivsRouter';

// LEGACY: Keep old endpoints for backward compatibility
export {
  hostStart as hostStartLegacy,
  hostEnd as hostEndLegacy,
  guestJoin as guestJoinLegacy,
  viewerJoin as viewerJoinLegacy,
} from './live/liveRoutes';
```

---

## Request/Response Flow

### Host Flow

```
[Mobile App]
  ├─ POST /api/ivs/host-start
  ├─ Authorization: Bearer <cognito-token>
  └─ Body: { streamId?, stageArnOverride? }
        ↓
[Router: hostStart()]
  ├─ extractCognitoUserId() → "user-123"
  ├─ Get stageArn from env or body
  └─ Call ivsRealtime.createParticipantToken()
        ↓
[Service: IvsRealtimeService]
  ├─ Call AWS CreateParticipantTokenCommand
  ├─ Map role: 'PUBLISHER' → 'PUBLISH'
  └─ Return { token, stageArn, region, expiresAt }
        ↓
[Response: 200 OK]
{
  "ok": true,
  "role": "host",
  "userId": "user-123",
  "streamId": "stream-...",
  "stageArn": "arn:aws:ivs:...",
  "region": "eu-west-1",
  "token": "eyJh...",
  "expiresAt": "2025-12-07T14:30:00Z"
}
```

### Guest Flow

```
[Mobile App]
  ├─ POST /api/ivs/guest-join
  ├─ Authorization: Bearer <cognito-token>
  └─ Body: { streamId, stageArn }
        ↓
[Router: guestJoin()]
  ├─ extractCognitoUserId() → "user-456"
  ├─ Validate streamId and stageArn present
  └─ Call ivsRealtime.createParticipantToken()
        ↓
[Response: 200 OK]
{
  "ok": true,
  "role": "guest",
  "userId": "user-456",
  "streamId": "stream-...",
  "token": "eyJh...",
  ...
}
```

### Viewer Flow

```
[Mobile App]
  ├─ POST /api/ivs/viewer-join
  ├─ Authorization: Bearer <cognito-token>
  └─ Body: { streamId? }
        ↓
[Router: viewerJoin()]
  ├─ extractCognitoUserId() → "user-789"
  └─ Call ivsViewer.getViewerInfo()
        ↓
[Service: IvsViewerService]
  └─ Return { playbackUrl, viewerId }
        ↓
[Response: 200 OK]
{
  "ok": true,
  "role": "viewer",
  "userId": "user-789",
  "streamId": "stream-...",
  "playbackUrl": "https://d.ivs.aws.com/index.m3u8"
}
```

---

## Error Handling

### 400 Bad Request
```json
{
  "ok": false,
  "error": "Request body must include streamId and stageArn"
}
```

### 401 Unauthorized
```json
{
  "ok": false,
  "error": "Missing Authorization header"
}
```

### 405 Method Not Allowed
```json
{
  "ok": false,
  "error": "Method not allowed. Use POST."
}
```

### 500 Server Error
```json
{
  "ok": false,
  "error": "Failed to create IVS participant token: Access Denied"
}
```

---

## Type Definitions

### Cognito Payload

```typescript
interface CognitoTokenPayload {
  sub: string;                  // User ID (required)
  'cognito:username'?: string;  // Username
  email?: string;               // Email
  email_verified?: boolean;
  aud?: string;                 // Audience (client ID)
  iss?: string;                 // Issuer (user pool URL)
  iat?: number;                 // Issued at (unix timestamp)
  exp?: number;                 // Expiration (unix timestamp)
  [key: string]: any;           // Additional claims
}
```

### IVS Token Response

```typescript
interface IvsTokenResponse {
  token: string;                      // Signed JWT from AWS
  stageArn: string;
  region: string;
  issuedAt: number;                   // Unix timestamp (ms)
  expiresAt: number;                  // Unix timestamp (ms)
  role: 'PUBLISHER' | 'SUBSCRIBER';
}
```

### API Response

```typescript
interface IvsApiResponse {
  ok: boolean;
  role: 'host' | 'guest' | 'viewer';
  userId: string;
  streamId: string;
  stageArn?: string;                  // Host/guest only
  region?: string;                    // Host/guest only
  token?: string;                     // Host/guest only (JWT)
  playbackUrl?: string;               // Viewer only (HLS URL)
  expiresAt?: string;                 // ISO 8601 timestamp
  error?: string;                     // If ok === false
}
```

---

## Configuration

### Environment Variables

```env
# AWS Configuration
AWS_REGION=eu-west-1
AWS_ACCESS_KEY_ID=<access-key>
AWS_SECRET_ACCESS_KEY=<secret-key>

# IVS Configuration
IVS_REALTIME_STAGE_ARN=arn:aws:ivs:eu-west-1:123456789012:stage/blyp-live-broadcast
IVS_PLAYBACK_URL=https://d7b3c4f5a.ivs.aws.com/index.m3u8
```

### AWS IAM Permissions

```json
{
  "Effect": "Allow",
  "Action": [
    "ivs:CreateParticipantToken",
    "ivs:GetStage",
    "ivs:ListStages"
  ],
  "Resource": "arn:aws:ivs:*:*:stage/*"
}
```

---

## Deployment

### Build
```bash
cd functions
npm run build
```

### Deploy
```bash
firebase deploy --only functions
```

### Verify
```bash
firebase functions:log
# Look for [IVS_API] and [IVS_SERVICE] logs
```

---

## Next Steps

1. **Deploy Backend**
   - Build functions
   - Set environment variables in Firebase Console
   - Deploy to Firebase

2. **Update Mobile App**
   - Comment out `EXPO_PUBLIC_IVS_DEV_BYPASS`
   - Set `EXPO_PUBLIC_API_BASE_URL` to Firebase endpoint
   - Reload dev client

3. **Test Integration**
   - Navigate to Go Live
   - Try to start broadcast
   - Should now call real backend

4. **Production Hardening**
   - Implement JWT signature verification
   - Add rate limiting
   - Set up monitoring/alerts
   - Review TODO notes in `IVS_BACKEND_API.md`
