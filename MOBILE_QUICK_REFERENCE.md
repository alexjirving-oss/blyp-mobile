# 🎯 IVS Mobile Integration - Quick Reference

## 1. What Changed

| File | What | Lines |
|------|------|-------|
| `src/api/ivsLiveApi.ts` | Complete rewrite with new types and production logic | 358 |
| `src/live/ivs/hooks/useIVSHostSession.ts` | Updated to use `response.token` instead of `response.participantToken` | 2 lines |
| `src/live/ivs/hooks/useIVSViewerSession.ts` | Updated to use `response.playbackUrl` directly | 2 lines |

## 2. Type Signatures (Copy-Paste)

```typescript
// Host
export async function ivsHostStart(params?: IVSHostStartParams): Promise<IvsHostStartResponse>

// Guest  
export async function ivsGuestJoin(params?: IVSGuestJoinParams): Promise<IvsGuestJoinResponse>

// Viewer
export async function ivsViewerJoin(params?: IVSViewerJoinParams): Promise<IvsViewerJoinResponse>
```

## 3. Environment Rules

**Dev (use mock tokens):**
```env
EXPO_PUBLIC_IVS_DEV_BYPASS=1
```

**Prod (use real backend):**
```env
EXPO_PUBLIC_IVS_DEV_BYPASS=0
EXPO_PUBLIC_API_BASE_URL=https://your-project.cloudfunctions.net
```

## 4. Decision Tree

```
Does app have EXPO_PUBLIC_IVS_DEV_BYPASS=1?
├─ YES and __DEV__=true  → Use mock tokens (no backend)
├─ YES and __DEV__=false → ERROR logged (catch in tests)
└─ NO → Use real backend (requires EXPO_PUBLIC_API_BASE_URL)
```

## 5. Error Prevention

```typescript
// ✅ SAFE: Token is validated before use
if (!token || typeof token !== 'string') {
  throw new Error('[IVS_API] Invalid token');
}
// Only reaches here if token is definitely a string
```

```typescript
// ❌ CRASH: Token not validated
const parts = jwtToken.split('.');  // ERROR if jwtToken is undefined
```

## 6. Testing

```bash
# Dev bypass (mock tokens)
export EXPO_PUBLIC_IVS_DEV_BYPASS=1
npx expo start --dev-client
# → Go Live, Start Broadcast, get mock token

# Real backend (AWS tokens)
export EXPO_PUBLIC_IVS_DEV_BYPASS=0
export EXPO_PUBLIC_API_BASE_URL=https://your-project.cloudfunctions.net
npx expo start --dev-client
# → Go Live, Start Broadcast, get real AWS token
```

## 7. Compilation

```bash
npm run typecheck  # ✅ PASS
npm run lint       # ✅ PASS
```

## 8. Files Modified Summary

```
src/api/ivsLiveApi.ts
  - Added: 4 TypeScript interfaces
  - Added: callIvsBackend() helper
  - Added: ivsHostStart(), ivsGuestJoin(), ivsViewerJoin()
  - Added: Mock token generation
  - Added: Config validation

src/live/ivs/hooks/useIVSHostSession.ts
  - Changed: response.participantToken → response.token

src/live/ivs/hooks/useIVSViewerSession.ts
  - Changed: Use response.playbackUrl directly
```

## 9. No More Crashes

| Error | Before | After |
|-------|--------|-------|
| Missing Cognito token | ❌ Crash: `.split()` | ✅ Error thrown |
| Invalid token format | ❌ Crash: `.split()` | ✅ Error thrown |
| Missing API_BASE_URL | ❌ Silent fail | ✅ Clear error |
| Backend error | ❌ Generic error | ✅ Detailed error |

## 10. Next Steps

1. Deploy backend: `firebase deploy --only functions`
2. Set env vars in Firebase Console
3. Update mobile `.env`
4. Test end-to-end
5. Deploy to production

---

**Status: ✅ COMPLETE AND READY** 🚀
