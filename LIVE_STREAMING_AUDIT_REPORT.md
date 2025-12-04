# Live Streaming Comprehensive Audit Report
**Date:** December 4, 2025  
**Scope:** Full audit of Blyp Mobile live streaming implementation  
**Status:** 🔴 CRITICAL ISSUES IDENTIFIED

---

## Executive Summary

The live streaming system has **multiple critical authentication and architecture issues** preventing basic functionality like commenting. The root cause is a **dual authentication system (Cognito + Firebase) with inconsistent synchronization**, combined with service-level code that expects `auth.currentUser` to be populated, but this doesn't happen in Cognito-first scenarios.

### Critical Error from Screenshot
```
Console Error
Error sending comment: Error: User must be logged in

Call Stack
addLog
  C:\Users\Alex\369369369\node...es\LogBox\Data\LogBoxData.js
addConsoleLog
  C:\Users\Alex\369369369\node...ive\Libraries\LogBox\LogBox.js
reactConsoleErrorHandler
  C:\Users\Alex\369369369\node...es\Core\ExceptionsManager.js
console.level1
  C:\Users\Alex\369369369\node...s\Core\setUpDeveloperTools.js
sendComment
  C:\Users\Alex\369369369\src\screens\LiveStreamScreen.js
```

This error occurs because:
1. **LiveStreamScreen calls `HLSLiveStreamService.addComment()`**
2. **`addComment()` checks `auth.currentUser`** (line 798 in HLSLiveStreamService.js)
3. **But `auth` is a Firebase auth instance, and the user is logged in via Cognito, NOT Firebase**
4. **Result: `auth.currentUser === null` → throw error**

---

## 🔴 Critical Issues

### Issue #1: Dual Auth System Without Sync ⚠️ **BLOCKER**
**Location:** `src/config/firebase.js`, `src/hooks/useCommon.js`, `src/services/HLSLiveStreamService.js`

#### Current State
- App uses **Cognito** as primary auth provider (`useAuth()` hook in `useCommon.js`)
- Firebase auth is **optionally enabled** via env flags but NOT automatically synced with Cognito
- Services like `HLSLiveStreamService` directly check `auth.currentUser` (Firebase auth)
- **When user logs in via Cognito → Firebase `auth.currentUser` remains `null`**

#### Code Evidence
```javascript
// HLSLiveStreamService.js line 798
async addComment(streamId, content) {
  try {
    const user = auth.currentUser; // ❌ THIS IS NULL when logged in via Cognito
    if (!user) throw new Error('User must be logged in');
    // ...
  }
}
```

```javascript
// LiveStreamScreen.js line 38
const { uid, isAuthenticated, authReady, loading: authLoading } = useAuth(); // ✅ Cognito auth
// BUT services don't use this uid, they check auth.currentUser directly
```

#### Expected State
- Either: Use single canonical auth provider (Cognito OR Firebase, not both)
- Or: Implement bidirectional auth sync so `auth.currentUser` is populated when Cognito user exists
- Services must accept `userId` param instead of relying on global `auth.currentUser`

---

### Issue #2: Missing Auth Params in Service Calls ⚠️ **BLOCKER**
**Location:** `src/screens/LiveStreamScreen.js` lines 580-588

#### Current State
```javascript
// LiveStreamScreen.js line 580
const sendComment = async () => {
  if (!newComment.trim() || !streamId) return;
  try {
    await HLSLiveStreamServiceInstance.addComment(streamId, newComment);
    //                                                      ❌ NO userId param
    setNewComment('');
  } catch (error) {
    console.error('Error sending comment:', error);
  }
};
```

But `LiveStreamScreen` HAS the auth state from `useAuth()`:
```javascript
// LiveStreamScreen.js line 38
const { uid, isAuthenticated, authReady, loading: authLoading } = useAuth();
```

#### Expected State
```javascript
const sendComment = async () => {
  if (!newComment.trim() || !streamId) return;
  if (!uid) {
    console.error('Cannot send comment: not authenticated');
    return;
  }
  try {
    // Pass uid explicitly instead of relying on auth.currentUser
    await HLSLiveStreamServiceInstance.addComment(streamId, newComment, uid);
    setNewComment('');
  } catch (error) {
    console.error('Error sending comment:', error);
  }
};
```

---

### Issue #3: Service Methods Rely on Global Auth State ⚠️ **ARCHITECTURAL FLAW**
**Location:** `src/services/HLSLiveStreamService.js`

#### Current State
Multiple methods in `HLSLiveStreamService` check `auth.currentUser`:
- Line 798: `addComment()` 
- Line 876: `subscribeToLikes()`
- Line 902: `toggleLike()`
- Line 942: `likesCount()`

This creates tight coupling and breaks when:
- Using Cognito instead of Firebase auth
- Testing (mocking global state is brittle)
- Supporting multiple auth providers

#### Code Evidence
```javascript
// HLSLiveStreamService.js lines 796-800
async addComment(streamId, content) {
  try {
    const user = auth.currentUser;  // ❌ Global dependency
    if (!user) throw new Error('User must be logged in');
    // ...
  }
}
```

#### Expected State
```javascript
// Accept userId as explicit parameter
async addComment(streamId, content, userId) {
  if (!userId) throw new Error('User must be logged in');
  
  // Optionally verify against auth.currentUser if Firebase is enabled
  if (auth.currentUser && auth.currentUser.uid !== userId) {
    console.warn('Auth mismatch detected');
  }
  
  const comment = {
    userId: userId,  // Use provided userId
    // ...
  };
  
  await db.collection('liveStreams').doc(streamId).collection('comments').add(comment);
}
```

---

### Issue #4: Missing Firestore Security Rules for Comments ⚠️ **SECURITY RISK**
**Location:** `firestore.rules` lines 54-68

#### Current State
Rules exist but are **incomplete** for the `comments` subcollection:
```plaintext
// firestore.rules lines 54-68
match /comments/{commentId} {
  allow read: if true;
  
  allow create: if isAuthenticated()
    && isOwner(request.resource.data.userId)
    && isValidString(request.resource.data.content, 1000)
    && request.resource.data.userId == request.auth.uid;
  
  // Only comment author can update/delete their own comment
  allow update, delete: if isAuthenticated()
    && isOwner(resource.data.userId);
}
```

#### Issues
1. **Cognito users can't write** because rules check `request.auth.uid` (Firebase auth UID)
2. **No mapping** between Cognito UID and Firebase UID
3. **`isOwner(request.resource.data.userId)` is redundant** with second check `request.resource.data.userId == request.auth.uid`

#### Expected State
```plaintext
match /comments/{commentId} {
  allow read: if true;
  
  // Allow any authenticated user to create comments
  // Store userId in the document for attribution
  allow create: if isAuthenticated()
    && request.resource.data.userId is string
    && request.resource.data.userId.size() > 0
    && isValidString(request.resource.data.content, 1000);
  
  // Only comment author can update/delete
  allow update, delete: if isAuthenticated()
    && resource.data.userId == request.auth.uid;
}
```

**OR** if supporting Cognito:
```plaintext
match /comments/{commentId} {
  allow read: if true;
  
  // Allow any authenticated user (Cognito or Firebase)
  allow create: if request.auth != null
    && request.resource.data.userId is string
    && isValidString(request.resource.data.content, 1000);
  
  // Trust userId field for Cognito users (validated at app level)
  allow update, delete: if request.auth != null
    && resource.data.userId == request.auth.uid;
}
```

---

### Issue #5: Auth State Not Passed to Services ⚠️ **INTEGRATION ISSUE**
**Location:** Throughout `src/screens/LiveStreamScreen.js`

#### Current State
Screen has auth state from `useAuth()` but **never passes it to service methods**:

```javascript
// LiveStreamScreen.js
const { uid, isAuthenticated, authReady } = useAuth(); // ✅ Has uid

// Line 307: Stream creation - CORRECT (passes userId)
const result = await backend.createStream({
  userId: uid,  // ✅ Passed correctly
  title: title,
  // ...
});

// Line 505: Stream ending - CORRECT (passes userId)
const endResult = await backend.endStream({ streamId, userId: uid }); // ✅

// Line 455: Segment upload - CORRECT (passes userId)
await HLSLiveStreamServiceInstance.uploadSegment(
  streamId,
  videoUri,
  segmentNumber,
  uid  // ✅ Passed correctly
);

// Line 580: Comment sending - ❌ INCORRECT (no userId)
await HLSLiveStreamServiceInstance.addComment(streamId, newComment);
//                                                         ❌ Missing uid param
```

#### Expected State
**ALL service calls** should pass `userId` explicitly:
```javascript
// Consistent pattern across all operations
await HLSLiveStreamServiceInstance.addComment(streamId, newComment, uid);
await HLSLiveStreamServiceInstance.toggleLike(streamId, uid);
await HLSLiveStreamServiceInstance.subscribeToLikes(streamId, uid, callback);
```

---

## 📊 Comparison Tables

### Table 1: Authentication Flow

| Component | Current Implementation | Expected Implementation | Status |
|-----------|----------------------|------------------------|--------|
| **Primary Auth** | Cognito via `useAuth()` hook | Same OR standardize on Firebase | ⚠️ Inconsistent |
| **Firebase Auth** | Optional, not synced | Should auto-sync OR be single source | ❌ Broken |
| **Service Auth Check** | `auth.currentUser` (Firebase) | Accept `userId` param | ❌ Broken |
| **Auth Propagation** | Screen has `uid`, doesn't pass it | Pass `userId` to all service calls | ❌ Broken |
| **Firestore Rules** | Check `request.auth.uid` (Firebase) | Support Cognito OR map UIDs | ⚠️ Incompatible |

---

### Table 2: Comment System Architecture

| Layer | Current Implementation | Expected Implementation | Status |
|-------|----------------------|------------------------|--------|
| **UI (LiveStreamScreen)** | Has `uid` from `useAuth()` | Same | ✅ OK |
| **UI → Service Call** | `addComment(streamId, content)` | `addComment(streamId, content, userId)` | ❌ Missing param |
| **Service (HLSLiveStreamService)** | Checks `auth.currentUser` | Use provided `userId` param | ❌ Wrong approach |
| **Firestore Write** | Uses `auth.currentUser.uid` | Use `userId` param | ❌ Fails |
| **Security Rules** | `request.auth.uid == Firebase UID` | Accept Cognito UID OR map | ❌ Blocks Cognito |
| **Comment Storage** | `liveStreams/{id}/comments` subcollection | Same | ✅ OK |

---

### Table 3: Service Method Signatures

| Method | Current Signature | Expected Signature | Impact |
|--------|------------------|-------------------|--------|
| `createStream()` | `createStream({ title, userId, ... })` | Same | ✅ Already correct |
| `uploadSegment()` | `uploadSegment(streamId, uri, n, userId)` | Same | ✅ Already correct |
| `endStream()` | `endStream({ streamId, userId })` | Same | ✅ Already correct |
| `addComment()` | `addComment(streamId, content)` | `addComment(streamId, content, userId)` | ❌ **NEEDS FIX** |
| `toggleLike()` | `toggleLike(streamId)` | `toggleLike(streamId, userId)` | ❌ **NEEDS FIX** |
| `subscribeToLikes()` | `subscribeToLikes(streamId, callback)` | `subscribeToLikes(streamId, userId, callback)` | ⚠️ **NEEDS REVIEW** |

---

### Table 4: Firestore Security Rules

| Collection Path | Current Rule | Expected Rule | Status |
|----------------|-------------|--------------|--------|
| `liveStreams/{streamId}` | `create: isAuthenticated() && isOwner(userId)` | Same | ✅ OK |
| `liveStreams/{streamId}/comments` | `create: isAuthenticated() && userId == request.auth.uid` | `create: isAuthenticated() && userId is valid string` | ❌ **BLOCKS COGNITO** |
| `liveStreams/{streamId}/likes` | `create/delete: isAuthenticated() && isOwner(userId)` | Same | ⚠️ **NEEDS VERIFICATION** |
| `liveStreams/{streamId}/segments` | `create: isAuthenticated() && isOwner(stream.userId)` | Same | ✅ OK |

---

## 🔧 Architectural Analysis

### Current Architecture (Broken)
```
┌──────────────────┐
│ LiveStreamScreen │
│   (has uid)      │
└────────┬─────────┘
         │
         │ ❌ Doesn't pass uid
         ▼
┌─────────────────────┐
│ HLSLiveStreamService│
│  checks auth.       │  ❌ Returns null
│  currentUser ───────┼─────────► Firebase Auth
└─────────┬───────────┘            (not signed in)
          │
          │ ❌ Write fails
          ▼
    ┌──────────┐
    │ Firestore│
    │  Rules   │  ❌ Rejects: request.auth.uid == null
    └──────────┘

Meanwhile:
┌──────────┐
│ Cognito  │  ✅ User IS logged in here
│   Auth   │     but disconnected from Firebase
└──────────┘
```

### Expected Architecture (Fixed)
```
┌──────────────────┐
│ LiveStreamScreen │
│   (has uid from  │
│    useAuth())    │
└────────┬─────────┘
         │
         │ ✅ Passes uid explicitly
         ▼
┌─────────────────────┐
│ HLSLiveStreamService│
│  uses provided      │
│  userId param       │
└─────────┬───────────┘
          │
          │ ✅ Write with userId
          ▼
    ┌──────────┐
    │ Firestore│
    │  Rules   │  ✅ Accepts: userId field is valid
    │          │     (relaxed auth check)
    └──────────┘

Option A: Cognito-only (simpler)
┌──────────┐
│ Cognito  │  ✅ Single source of truth
│   Auth   │
└──────────┘

Option B: Sync Firebase auth with Cognito
┌──────────┐      sync       ┌──────────┐
│ Cognito  │ ◄──────────────► │ Firebase │
│   Auth   │                  │   Auth   │
└──────────┘                  └──────────┘
```

---

## 🎯 Root Cause Analysis

### Primary Root Cause
**Dual authentication system without synchronization.**

The app was designed to use Firebase auth, but Cognito was added as the primary provider without updating:
1. Service layer code (still checks `auth.currentUser`)
2. Security rules (still expect `request.auth.uid` to be Firebase UID)
3. Integration points (UI doesn't pass `uid` to services)

### Contributing Factors
1. **Implicit vs Explicit Auth:** Services use implicit global `auth.currentUser` instead of explicit `userId` params
2. **Copy-Paste from Firebase Examples:** Service code follows Firebase docs pattern (`auth.currentUser`) without adaptation
3. **Missing Integration Tests:** No tests catching auth provider mismatch
4. **Incomplete Migration:** Stream creation/upload were updated to pass `userId`, but comments/likes were not

---

## 🔨 Recommended Fixes

### Fix Priority: CRITICAL (Complete All Before Next Release)

### Fix #1: Update `addComment()` Signature ⚠️ **REQUIRED**
**File:** `src/services/HLSLiveStreamService.js` line 796

```javascript
// BEFORE (broken)
async addComment(streamId, content) {
  try {
    const user = auth.currentUser;
    if (!user) throw new Error('User must be logged in');
    
    await this.migrateEmbeddedComments(streamId);
    
    const comment = {
      userId: user.uid,
      userName: user.displayName || 'Anonymous',
      userPhotoURL: user.photoURL || null,
      content: content.trim(),
      timestamp: serverTimestamp(),
      likes: 0,
      isHighlighted: false
    };
    
    await db.collection('liveStreams').doc(streamId).collection('comments').add(comment);
    console.log(`💬 Comment added to stream ${streamId}`);
  } catch (error) {
    console.error('❌ Error adding comment:', error);
    throw error;
  }
}

// AFTER (fixed)
async addComment(streamId, content, userId, userName = null, userPhotoURL = null) {
  console.log('[HLS][addComment] Called with:', { streamId, userId, hasContent: !!content });
  
  if (!userId || typeof userId !== 'string') {
    throw new Error('userId is required to add comment');
  }
  
  if (!content || !content.trim()) {
    throw new Error('Comment content cannot be empty');
  }
  
  try {
    await this.migrateEmbeddedComments(streamId);
    
    // Optional: verify Firebase auth if available (but don't require it)
    if (auth.currentUser && auth.currentUser.uid !== userId) {
      console.warn('⚠️ Auth mismatch: Firebase UID differs from provided userId', {
        firebaseUid: auth.currentUser.uid,
        providedUserId: userId
      });
    }
    
    const comment = {
      userId: userId,
      userName: userName || 'Anonymous',
      userPhotoURL: userPhotoURL || null,
      content: content.trim(),
      timestamp: serverTimestamp(),
      likes: 0,
      isHighlighted: false
    };
    
    await db.collection('liveStreams').doc(streamId).collection('comments').add(comment);
    console.log(`✅ Comment added to stream ${streamId} by user ${userId}`);
    
  } catch (error) {
    console.error('❌ Error adding comment:', error);
    throw error;
  }
}
```

---

### Fix #2: Update LiveStreamScreen Call Site ⚠️ **REQUIRED**
**File:** `src/screens/LiveStreamScreen.js` line 580

```javascript
// BEFORE (broken)
const sendComment = async () => {
  if (!newComment.trim() || !streamId) return;
  try {
    await HLSLiveStreamServiceInstance.addComment(streamId, newComment);
    setNewComment('');
  } catch (error) {
    console.error('Error sending comment:', error);
  }
};

// AFTER (fixed)
const sendComment = async () => {
  if (!newComment.trim() || !streamId) return;
  
  // Guard: ensure user is authenticated
  if (!uid || !isAuthenticated) {
    console.error('❌ Cannot send comment: user not authenticated');
    Alert.alert('Login Required', 'You must be logged in to comment.');
    return;
  }
  
  try {
    // Pass uid explicitly from useAuth() hook
    await HLSLiveStreamServiceInstance.addComment(
      streamId, 
      newComment, 
      uid,
      // Optional: pass display name and photo URL if available
      null,  // userName (service will use 'Anonymous')
      null   // userPhotoURL
    );
    setNewComment('');
    console.log('✅ Comment sent successfully');
  } catch (error) {
    console.error('❌ Error sending comment:', error);
    Alert.alert('Error', 'Failed to send comment. Please try again.');
  }
};
```

---

### Fix #3: Update Firestore Rules ⚠️ **REQUIRED**
**File:** `firestore.rules` lines 54-68

```plaintext
// BEFORE (broken for Cognito users)
match /comments/{commentId} {
  allow read: if true;
  
  allow create: if isAuthenticated()
    && isOwner(request.resource.data.userId)
    && isValidString(request.resource.data.content, 1000)
    && request.resource.data.userId == request.auth.uid;
  
  allow update, delete: if isAuthenticated()
    && isOwner(resource.data.userId);
}

// AFTER (supports both Cognito and Firebase)
match /comments/{commentId} {
  allow read: if true;
  
  // Allow any authenticated user to create comments
  // We trust the app layer to pass correct userId (Cognito or Firebase)
  allow create: if isAuthenticated()
    && request.resource.data.userId is string
    && request.resource.data.userId.size() > 0
    && request.resource.data.userId.size() < 256
    && isValidString(request.resource.data.content, 1000)
    && request.resource.data.timestamp != null;
  
  // For update/delete, still require Firebase auth match if using Firebase
  // OR trust userId field if using Cognito (validated at app level)
  allow update, delete: if isAuthenticated()
    && (resource.data.userId == request.auth.uid  // Firebase user
        || request.auth.token.firebase.sign_in_provider == 'anonymous');  // Or relaxed for Cognito
}
```

**Note:** This relaxed rule trusts the app layer to pass correct `userId`. For stricter security with Cognito, implement a Cloud Function to map Cognito tokens to custom Firebase claims.

---

### Fix #4: Similarly Fix `toggleLike()` ⚠️ **RECOMMENDED**
**File:** `src/services/HLSLiveStreamService.js` line 902

```javascript
// BEFORE
async toggleLike(streamId) {
  const user = auth.currentUser;
  if (!user) throw new Error('User must be logged in');
  // ...
}

// AFTER
async toggleLike(streamId, userId) {
  if (!userId) throw new Error('userId is required to toggle like');
  
  try {
    const likeDoc = db.collection('liveStreams')
      .doc(streamId)
      .collection('likes')
      .doc(userId);
    
    const snap = await likeDoc.get();
    
    if (snap.exists) {
      // Unlike
      await likeDoc.delete();
      await db.collection('liveStreams').doc(streamId).update({
        likes: increment(-1)
      });
      console.log(`👎 User ${userId} unliked stream ${streamId}`);
      return false;
    } else {
      // Like
      await likeDoc.set({
        userId: userId,
        timestamp: serverTimestamp()
      });
      await db.collection('liveStreams').doc(streamId).update({
        likes: increment(1)
      });
      console.log(`👍 User ${userId} liked stream ${streamId}`);
      return true;
    }
  } catch (error) {
    console.error('❌ Error toggling like:', error);
    throw error;
  }
}
```

---

### Fix #5: Add Auth Sync Mechanism (Long-term) ⚠️ **OPTIONAL**
**File:** `src/hooks/useCommon.js`

Add Firebase auth sync when Cognito user is detected:

```javascript
// In useAuth() hook, after Cognito auth is established
useEffect(() => {
  if (!uid || !isAuthenticated || !authReady) return;
  if (!firebaseEnabled) return;
  
  // Sync Firebase auth state with Cognito user
  const syncFirebaseAuth = async () => {
    try {
      if (!firebaseAuth.currentUser) {
        console.log('🔄 Syncing Firebase auth for Cognito user:', uid);
        
        // Option A: Sign in anonymously and map UID
        await signInAnonymously(firebaseAuth);
        console.log('✅ Firebase auth synced (anonymous)');
        
        // Option B: Use custom token (requires Cloud Function)
        // const customToken = await fetch('/api/createCustomToken', {
        //   method: 'POST',
        //   body: JSON.stringify({ cognitoUid: uid })
        // });
        // await signInWithCustomToken(firebaseAuth, customToken);
      }
    } catch (error) {
      console.error('❌ Failed to sync Firebase auth:', error);
    }
  };
  
  syncFirebaseAuth();
}, [uid, isAuthenticated, authReady]);
```

---

## 📋 Testing Checklist

After implementing fixes, verify:

- [ ] **Comment posting works** when logged in via Cognito
- [ ] **Comment posting works** when logged in via Firebase (if enabled)
- [ ] **Comments appear in real-time** for all viewers
- [ ] **Like/unlike works** with Cognito auth
- [ ] **View count updates** correctly
- [ ] **Stream creation** still works (already passing userId correctly)
- [ ] **Segment upload** still works (already passing userId correctly)
- [ ] **Stream ending** still works (already passing userId correctly)
- [ ] **No auth errors** in LogBox/console
- [ ] **Firestore rules** don't block legitimate writes

---

## 📊 Impact Assessment

### User Impact
- **Current:** 100% of users CANNOT comment on live streams (app-wide broken feature)
- **After Fix:** Full commenting functionality restored

### Code Impact
- **Files Modified:** 3 files
  - `src/services/HLSLiveStreamService.js` (addComment, toggleLike methods)
  - `src/screens/LiveStreamScreen.js` (sendComment, sendHeart functions)
  - `firestore.rules` (comments subcollection rules)

### Risk Assessment
- **Risk Level:** LOW (changes are localized and additive)
- **Rollback Plan:** Revert commits if errors occur
- **Testing Required:** Manual testing on dev build before production release

---

## 🚀 Implementation Plan

### Phase 1: Emergency Fix (1 hour)
1. Update `HLSLiveStreamService.addComment()` to accept `userId` param
2. Update `LiveStreamScreen.sendComment()` to pass `uid`
3. Deploy and test on dev build

### Phase 2: Complete Fix (2 hours)
1. Update `toggleLike()` and related methods
2. Update Firestore rules for comments/likes
3. Add error handling and user feedback
4. Test all live streaming features end-to-end

### Phase 3: Long-term (1 week)
1. Implement Firebase auth sync with Cognito
2. Add integration tests for auth flows
3. Document auth architecture in README
4. Consider consolidating to single auth provider

---

## 📚 Related Documentation

- **Auth Consolidation Plan:** `AUTH_CONSOLIDATION_PLAN.md`
- **Firebase Setup:** `FIREBASE_SETUP.md`
- **Firestore Rules:** `FIREBASE_RULES_QUICK_REF.md`
- **Streaming Backend:** `src/streaming/StreamingBackendFactory.js`

---

## ✅ Acceptance Criteria

Fixes are complete when:

1. ✅ User can post comments on live streams without errors
2. ✅ Comments appear in real-time for all viewers
3. ✅ Likes/unlikes work correctly
4. ✅ No "User must be logged in" errors in console
5. ✅ Firestore rules allow Cognito users to write
6. ✅ All existing stream features still work (create/upload/end)

---

## 🔍 Additional Findings

### Positive Findings
- ✅ Stream creation already passes `userId` correctly
- ✅ Segment upload already passes `userId` correctly
- ✅ Firestore rules for main `liveStreams` collection are correct
- ✅ Real-time comment subscription logic is sound
- ✅ UI has proper auth state from `useAuth()` hook

### Areas for Improvement (Non-Critical)
- ⚠️ Consider standardizing on single auth provider (Cognito OR Firebase)
- ⚠️ Add integration tests for live streaming features
- ⚠️ Implement proper error boundaries for auth failures
- ⚠️ Add analytics for comment/like actions
- ⚠️ Consider adding rate limiting for comments (spam prevention)

---

**Report Generated:** December 4, 2025  
**Next Steps:** Implement Phase 1 fixes immediately, then schedule Phase 2 within this sprint.
