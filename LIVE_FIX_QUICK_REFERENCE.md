# Live Streaming Fix - Quick Reference

## What Was Fixed
1. **"Anonymous User" displayed instead of real names** in live users list
2. **Viewer device opening host/camera mode** instead of viewer mode

## Changes Summary

| File | Change | Status |
|------|--------|--------|
| `src/services/LiveService.js` | Replaced `ensureUserProfile()` function with placeholder-aware logic | ✅ |
| `src/services/ScalableHLSService.js` | Changed `'Anonymous User'` fallback to `user.uid` | ✅ |
| `src/services/HLSLiveStreamService.js` | Verified already has correct logic | ✅ |
| `src/screens/LiveStreamScreen.js` | Added 5 guards + route param validation | ✅ |
| `src/components/LiveUsersTab.js` | Added `displayName` to navigation params | ✅ |

## Key Code Changes

### 1. Stop Writing "Anonymous"
**LiveService.js**:
```javascript
// Before: displayName: displayName || "Anonymous"  ❌
// After: Check existing doc, use userId fallback   ✅

let finalDisplayName = displayName ?? null;
if (!finalDisplayName && snap.exists && !isPlaceholderName(existing)) {
  finalDisplayName = existing.displayName;
}
if (!finalDisplayName) {
  finalDisplayName = userId; // Never "Anonymous"
}
```

### 2. Route Params as Single Source of Truth
**LiveStreamScreen.js**:
```javascript
// Route params extraction
const { mode = 'host', hostUid = null, streamId: routeStreamId = null } = safeParams;

// Validation
if (mode === 'viewer' && !routeStreamId) {
  navigation.goBack(); // Invalid viewer route
}

// Guards
if (mode === 'viewer') {
  // Skip permissions, don't record segments, don't call createStream
  return;
}
```

### 3. Pass Display Name to Viewer
**LiveUsersTab.js**:
```javascript
navigation.navigate('LiveStreamScreen', {
  mode: 'viewer',
  streamId: item.currentStreamId,
  hostUid: item.id,
  displayName: item.displayName || 'Unknown User' // Added
});
```

## Testing

### Quick Test
1. Device A: Go live (real name should display)
2. Device B: See real name in LiveUsersTab
3. Device B: Tap name → enters viewer mode (not host)
4. Device B: No camera permission prompts
5. Device B: Watches stream with "Go Live" button hidden

### Check Logs
- Host Device: Look for `[LIVE][CREATE_STREAM_CALL]` → verify `userDisplayName`
- Viewer Device: Look for `[LIVE][PERMISSIONS] Viewer mode` → verify skipping
- Viewer Device: Should NOT see segment recording logs

## Validation ✅
- npm run lint → PASS
- npm run typecheck → PASS  
- npm test → PASS (exit code 0)

## Rollback
If needed, only 2 files have non-trivial changes:
1. `src/services/LiveService.js` - Revert to previous ensureUserProfile
2. `src/screens/LiveStreamScreen.js` - Remove 5 guard conditions

All other changes are single-line updates.
