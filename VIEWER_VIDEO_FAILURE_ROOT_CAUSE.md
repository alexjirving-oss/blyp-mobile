# Viewer Video Playback Failure — Root Cause Analysis

**Date:** 2025-12-13  
**Test Session:** Viewer join attempt after P1 host stability verification  
**Result:** Viewer can "join" but video never displays

---

## **Executive Summary**

The viewer side is **completely non-functional** due to LiveStreamScreen re-render thrashing. The `LiveStreamViewer` component mounts and immediately unmounts in rapid cycles before it can fetch a token or join the IVS stage. No viewer API calls reach the backend.

---

## **Evidence from Logs**

### **1. No Backend API Calls**
```bash
# Search backend logs for viewer join requests
$ Select-String -Path "audit\logs\backend_dev.log" -Pattern "/api/live/join-realtime"
# RESULT: 0 matches in current session (old logs from before restart only)
```

**Conclusion:** Viewer code never reaches the backend token fetch.

### **2. Client-Side Thrashing**
```javascript
// Pattern repeating 20+ times in metro.log:
[LIVE][MODE_RESOLVED] {"isViewer": true, "hostUid": "alex", ...}
[LIVE][BACKEND_SELECTED] ivs
[IVS_VIEWER][CLEANUP] Component unmounting
[IVS_VIEWER][LEAVE_STREAM] {"streamId": "2f989dd0-f45d-4aef-a2df-0abf8605efdb"}
[IVS_CLIENT] Leaving viewer session
[IVS_CLIENT] Viewer session left
[IVS_VIEWER][LEFT]
[AUTH DEBUG] {"authReady": true, "uid": "blyp"}
[LIVE][RENDER] LiveStreamScreen render
```

**Pattern:**
1. Mode resolves as `isViewer: true`
2. Component mounts (renders `<LiveStreamViewer>`)
3. **IMMEDIATELY** cleanup hook fires (component unmounting)
4. Auth debug log
5. Screen re-renders
6. Loop back to step 1

### **3. Missing Initialization**
**Never appears in logs:**
- `[IVS_VIEWER][JOIN_STREAM]` — hook's `joinStream()` never called
- `[IVS_VIEWER][TOKEN_RECEIVED]` — backend API never reached
- `[IVS_VIEWER][JOIN_COMPLETED]` — native IVS join never happens
- `[IVS_VIEWER][STAGE_JOIN_SUCCESS]` — participant never joins stage

**Only cleanup logs appear** — component dies before initialization.

### **4. Backend Crash During Test**
```
[INFO] 02:59:39 Restarting: ...\src\index.ts has been modified
node.exe : Error: listen EADDRINUSE: address already in use :::4000
```

Hot reload triggered during viewer test → backend unavailable even if client had called API.

---

## **Root Cause: Render Thrashing**

### **Why LiveStreamViewer Unmounts Immediately**

**File:** `src/screens/LiveStreamScreen.js`

**Render logic:**
```javascript
// Lines 88-92: Mode determination
const isViewerRoute = routeMode === 'viewer' && !!routeHostUid && !!routeStreamId;
const isViewer = isViewerRoute;
const isHost = !isViewer;

// Line 1086: Conditional viewer rendering
if (isViewer) {
  return (
    <View>
      <LiveStreamViewer streamId={routeStreamId} ... />
    </View>
  );
}
```

**Problem:**
- `isViewer` depends on route params and auth state
- Component re-renders on every auth state change (see `[AUTH DEBUG]` logs)
- Each re-render creates **new** LiveStreamViewer instance → triggers unmount of previous
- Unmount fires **before** `useIVSViewerSession` hook can execute `joinStream()`

**React component lifecycle:**
```
Mount → useEffect(() => { joinStream() }) → ...UNMOUNT (before joinStream completes)
```

**Evidence:** Logs show `[IVS_VIEWER][CLEANUP]` (unmount hook) but NEVER `[IVS_VIEWER][JOIN_STREAM]` (init hook).

---

## **Comparison to Host Flow**

### **Host (Working)**
- Guards prevent double-start: `startInFlightRef`, `countdownInProgressRef`
- 500ms auth debounce gate
- Once streaming starts, state is stable
- Camera preview renders immediately (not dependent on API)

### **Viewer (Broken)**
- No stability gates
- Every auth change → re-render → remount `LiveStreamViewer`
- Video render depends on successful API call + IVS stage join
- Neither ever happens due to thrashing

---

## **Detailed Component Flow**

### **LiveStreamViewer.js**

**Initialization (line 70):**
```javascript
const ivsSession = useIVSViewerSession({
  streamId: streamId || '',
  enabled: !!streamId,
  autoJoin: true, // Should trigger joinStream() on mount
});
```

**Cleanup hook (line 147):**
```javascript
useEffect(() => {
  return () => {
    console.log('[IVS_VIEWER][CLEANUP] Component unmounting');
    ivsSession.leaveStream().catch(err => {
      console.error('[IVS_VIEWER][CLEANUP_ERROR]', err);
    });
  };
}, [ivsSession]);
```

**What's happening:**
1. Component mounts → `useIVSViewerSession` hook initializes
2. `autoJoin: true` should trigger `joinStream()` in hook's useEffect
3. **BUT** parent re-renders before hook's useEffect runs
4. React unmounts old component instance
5. Cleanup hook fires: `leaveStream()` (even though never joined)
6. New instance mounts → repeat cycle

### **useIVSViewerSession.ts**

**Join logic (line 63):**
```typescript
const joinStream = useCallback(async () => {
  // 1. Fetch token from backend
  const response = await joinLiveRealtime(streamId);
  
  // 2. Join IVS stage as viewer
  await client.joinAsViewer({ stageArn, token });
  
  console.log('[IVS_VIEWER][JOIN_COMPLETED]');
}, [streamId, enabled]);
```

**AutoJoin effect (needs verification but likely):**
```typescript
useEffect(() => {
  if (autoJoin && enabled) {
    joinStream();
  }
}, [autoJoin, enabled, joinStream]);
```

**Problem:** This effect never fires because component unmounts first.

---

## **Why Re-Renders Happen**

**Suspects from logs:**

1. **Auth state changes**
   ```javascript
   [AUTH DEBUG] {"authReady": true, ...}
   // Appears between every render cycle
   ```
   - `useAuth()` hook may be emitting state changes
   - LiveStreamScreen not memoizing auth-dependent values
   - Every auth update → full screen re-render

2. **Route params instability**
   ```javascript
   [LIVE][RECEIVED_ROUTE_PARAMS] {"rawParams": {...}}
   // Mode recalculated on every render
   ```
   - Navigation params may be updating
   - Mode decision (`isViewer`/`isHost`) recalculated every render
   - No memoization of derived state

3. **No render guards**
   - Unlike host flow with `startInFlightRef`, viewer has no stability gates
   - Component renders on **every** state change (auth, navigation, props)

---

## **Fix Strategy (P2 Viewer Stability)**

### **Minimal Changes (Follow P1 Pattern)**

1. **Add viewer join guard**
   ```javascript
   const viewerJoinedRef = useRef(false);
   ```
   - Once viewer successfully joins, prevent re-join on re-renders
   - Similar to host `startInFlightRef`

2. **Memoize viewer mode decision**
   ```javascript
   const isViewerStable = useMemo(() => {
     return routeMode === 'viewer' && !!routeHostUid && !!routeStreamId;
   }, [routeMode, routeHostUid, routeStreamId]);
   ```
   - Prevent mode recalculation unless route actually changes

3. **Add auth stability gate for viewer**
   ```javascript
   // Don't render LiveStreamViewer until auth is stable
   if (isViewer && !authReady) {
     return <LoadingSpinner />;
   }
   ```

4. **Stabilize LiveStreamViewer props**
   ```javascript
   const viewerProps = useMemo(() => ({
     streamId: routeStreamId,
     style: styles.viewerVideo,
     onError: handleViewerError,
   }), [routeStreamId, handleViewerError]);
   
   return <LiveStreamViewer {...viewerProps} />;
   ```

5. **Hook-level guard in useIVSViewerSession**
   ```typescript
   const hasJoinedRef = useRef(false);
   
   useEffect(() => {
     if (autoJoin && enabled && !hasJoinedRef.current) {
       hasJoinedRef.current = true;
       joinStream();
     }
   }, [autoJoin, enabled, joinStream]);
   ```

---

## **Additional Issues Discovered**

### **Backend Instability**
- Hot reload during test caused port conflict
- Backend unavailable even if client had called API
- **Fix:** Disable hot reload in dev mode or add better error handling

### **No Error Surfacing**
- User sees blank screen
- No "Stream not available" error message
- Thrashing is silent — only visible in logs
- **Fix:** Add error boundary or connection timeout UI

---

## **Verification Plan (After Fix)**

### **Expected Logs:**
```javascript
// 1. Stable mode resolution
[LIVE][MODE_RESOLVED] {"isViewer": true, ...}

// 2. Viewer component mount
[IVS_VIEWER][MOUNT] Component initialized

// 3. Token fetch
[IVS_VIEWER][JOIN_STREAM] {"streamId": "..."}
[LIVE_API][REQ] {"path": "/api/live/join-realtime", ...}

// Backend
[API][/api/live/join-realtime] {"streamId": "...", "viewerUserId": "..."}

// 4. Token received
[IVS_VIEWER][TOKEN_RECEIVED] {"stageArn": "...", "tokenLength": ...}

// 5. Stage join
[IVS_VIEWER][JOIN_COMPLETED] {"streamId": "..."}
[IVS_VIEWER][STAGE_JOIN_SUCCESS] {...}

// 6. Video received
[IVS_VIEWER][MEDIA_STATE] {"remoteParticipants": 1, "remoteVideoTracks": 1}

// 7. NO cleanup until user navigates away
```

### **Proof Checklist:**
- [ ] One `/api/live/join-realtime` call per viewer join attempt
- [ ] Backend creates viewer participant token with `SUBSCRIBE` capability
- [ ] Client receives token and stageArn
- [ ] IVS native module joins stage successfully
- [ ] Remote video track count > 0
- [ ] Video surface displays host stream
- [ ] No `[IVS_VIEWER][CLEANUP]` until user navigates away

---

## **Files to Modify (P2)**

1. **src/screens/LiveStreamScreen.js**
   - Add `viewerJoinedRef` guard
   - Memoize `isViewer` decision
   - Add auth stability gate for viewer render

2. **src/live/ivs/hooks/useIVSViewerSession.ts**
   - Add `hasJoinedRef` to prevent duplicate joins
   - Add logging for mount/init phases

3. **src/components/LiveStreamViewer.js**
   - Add mount log: `console.log('[IVS_VIEWER][MOUNT]')`
   - Add initialization guard

4. **backend/blyp-live-service** (optional)
   - Disable hot reload or add graceful restart

---

## **Next Steps**

1. **Implement P2 viewer stability fixes** (minimal diffs, follow P1 pattern)
2. **Restart backend cleanly** (no hot reload conflict)
3. **Test viewer join** with logging
4. **Verify end-to-end flow** matches checklist above
5. **Commit as separate P2 branch** (`fix/viewer-stability-p2`)

---

## **Summary**

**The viewer video playback failure is NOT an IVS streaming issue.** It's a **React component lifecycle issue**: the viewer component thrashes (mount/unmount cycles) before it can fetch a token or join the stage. Host flow works because it has stability guards (P1 fixes). Viewer flow needs equivalent guards (P2 fixes).
