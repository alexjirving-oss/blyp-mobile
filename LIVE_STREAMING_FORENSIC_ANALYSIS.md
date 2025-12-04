# Live Streaming Forensic Analysis
**Date:** December 4, 2025  
**Status:** 🔴 PROOF OF ROOT CAUSE CONFIRMED

---

## 1. Exact Error String Trace

### ✅ Found 4 Active Instances in Source Code

```bash
# grep -r "User must be logged in" src/
```

**Results:**
1. `src/services/HLSLiveStreamService.js:799` - **addComment()** ❌ CONFIRMED BLOCKER
2. `src/services/HLSLiveStreamService.js:877` - **addLike()** ❌ CONFIRMED BLOCKER
3. `src/services/HLSLiveStreamService.js:903` - **toggleLike()** ❌ CONFIRMED BLOCKER
4. `src/streaming/HLSStreamingBackend.ts:38` - createStream (already fixed with userId param)
5. `src/services/LiveService.js:42` - createStream (already fixed with userId param)

### 🎯 Smoking Gun: Line 798-799

```javascript
// src/services/HLSLiveStreamService.js:798-799
const user = auth.currentUser;
if (!user) throw new Error('User must be logged in');
```

**This is EXACTLY the error from the screenshot.**

---

## 2. Call Chain Analysis

### Screenshot Error Stack
```
Error sending comment: Error: User must be logged in

Call Stack:
  sendComment
    C:\Users\Alex\369369369\src\screens\LiveStreamScreen.js
```

### Actual Call Chain (Confirmed)

```
LiveStreamScreen.sendComment() [line 580]
  ↓ calls
HLSLiveStreamServiceInstance.addComment(streamId, newComment) [line 583]
  ↓ checks
auth.currentUser [line 798]
  ↓ result
null (because user is logged in via Cognito, NOT Firebase)
  ↓ throws
Error('User must be logged in') [line 799]
```

---

## 3. Authentication State Analysis

### Current Auth Flow

```javascript
// LiveStreamScreen.js:38 - HAS Cognito auth
const { uid, isAuthenticated, authReady, loading: authLoading } = useAuth();

// Result: uid = "eu-west-2:abc123..." (Cognito identity)
//         isAuthenticated = true
//         authReady = true
```

### Firebase Auth State

```javascript
// src/config/firebase.js:175 (if EFFECTIVE_DISABLE = true)
auth = {
  currentUser: null,  // ❌ ALWAYS NULL in Cognito-only mode
  onAuthStateChanged: (callback) => {
    try { callback(null); } catch {}
    return () => {};
  },
  // ...
};
```

**Proof:** User IS authenticated (Cognito) but Firebase `auth.currentUser` is null.

---

## 4. The Three Broken Methods

### Method 1: addComment() ❌ BROKEN

**Location:** `src/services/HLSLiveStreamService.js:796-825`

```javascript
async addComment(streamId, content) {
  try {
    const user = auth.currentUser;  // ❌ NULL when Cognito-authenticated
    if (!user) throw new Error('User must be logged in');
    
    await this.migrateEmbeddedComments(streamId);
    
    const comment = {
      userId: user.uid,              // ❌ CRASH: Cannot read uid of null
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
    throw error;  // ❌ This is the error user sees
  }
}
```

**Called from:** `LiveStreamScreen.js:583`
```javascript
await HLSLiveStreamServiceInstance.addComment(streamId, newComment);
//                                                       ❌ Missing uid param
```

---

### Method 2: addLike() ❌ BROKEN

**Location:** `src/services/HLSLiveStreamService.js:872-895`

```javascript
async addLike(streamId) {
  try {
    const user = auth.currentUser;  // ❌ NULL when Cognito-authenticated
    if (!user) throw new Error('User must be logged in');
    
    const streamRef = db.collection('liveStreams').doc(streamId);
    
    await streamRef.update({
      likes: increment(1),
      lastUpdated: serverTimestamp(),
      'streamHealth.engagementActivity': serverTimestamp()
    });
    
    console.log(`❤️ Like added to stream ${streamId}`);
  } catch (error) {
    console.error('❌ Error adding like:', error);
    throw error;
  }
}
```

**Called from:** `LiveStreamScreen.js:573` (sendHeart function)
```javascript
HLSLiveStreamServiceInstance.addLike(routeStreamId);
//                                   ❌ Missing uid param
```

---

### Method 3: toggleLike() ❌ BROKEN

**Location:** `src/services/HLSLiveStreamService.js:900-950`

```javascript
async toggleLike(streamId, isLiking) {
  try {
    const user = auth.currentUser;  // ❌ NULL when Cognito-authenticated
    if (!user) throw new Error('User must be logged in');
    
    const streamRef = db.collection('liveStreams').doc(streamId);
    const likeRef = streamRef.collection('likes').doc(user.uid);
    
    if (isLiking) {
      await likeRef.set({
        streamId,
        userId: user.uid,
        likedAt: serverTimestamp()
      });
      
      await streamRef.update({
        likes: increment(1),
        lastUpdated: serverTimestamp(),
        'streamHealth.engagementActivity': serverTimestamp()
      });
    } else {
      await likeRef.delete();
      await streamRef.update({
        likes: increment(-1),
        lastUpdated: serverTimestamp()
      });
    }
    
    console.log(`${isLiking ? '👍' : '👎'} Like toggled for stream ${streamId}`);
  } catch (error) {
    console.error('❌ Error toggling like:', error);
    throw error;
  }
}
```

**Not currently called from UI,** but would break if used.

---

## 5. Methods That Work Correctly ✅

### createStream() ✅ WORKS

**Location:** `src/services/HLSLiveStreamService.js:68-157`

```javascript
async createStream({ title, description, thumbnailFile, userId, userDisplayName, userPhotoURL } = {}) {
  console.log('[HLS][SERVICE][AUTH] createStream called with userId:', userId ? 'present' : 'MISSING');
  
  try {
    if (!firebaseEnabled || !db || !storage || typeof db.collection !== 'function') {
      console.warn('[HLS] Backend not configured for live streaming');
      return { ok: false, reason: 'HLS_BACKEND_NOT_CONFIGURED', error: 'Live streaming backend is not configured' };
    }
    
    // CRITICAL: Only check userId param, do NOT re-check auth.currentUser
    if (!userId || typeof userId !== 'string') {
      console.error('[HLS][SERVICE][AUTH] createStream blocked: userId param missing or invalid');
      return { ok: false, reason: 'NOT_LOGGED_IN', error: 'User must be logged in to stream' };
    }
    
    console.log('[HLS][SERVICE][AUTH] Proceeding with userId from caller:', userId);
    
    // ✅ Uses userId param, NOT auth.currentUser
    const streamData = {
      title: validTitle || 'Live Stream',
      description: validDescription || '',
      userId: userId,  // ✅ FROM PARAM
      userName: (userDisplayName && typeof userDisplayName === 'string') ? userDisplayName.trim() : 'Anonymous User',
      // ...
    };
    
    const streamRef = await db.collection('liveStreams').add(streamData);
    // ...
  }
}
```

**Called from:** `LiveStreamScreen.js:323`
```javascript
const result = await backend.createStream({
  userId: uid,  // ✅ PASSES uid from useAuth()
  title: title,
  displayName: null,
  photoURL: null,
  email: null,
});
```

---

### uploadSegment() ✅ WORKS

**Location:** `src/services/HLSLiveStreamService.js:163-350`

```javascript
async uploadSegment(streamId, videoUri, segmentNumber, userId) {
  console.log('[HLS][SERVICE][AUTH] uploadSegment called with userId:', userId ? 'present' : 'MISSING');
  
  try {
    // Production validation: Check all required parameters
    if (!streamId || typeof streamId !== 'string') {
      throw new Error('Invalid streamId: must be a non-empty string');
    }
    if (!videoUri || typeof videoUri !== 'string') {
      throw new Error('Invalid videoUri: must be a valid file URI string');
    }
    if (typeof segmentNumber !== 'number' || segmentNumber < 0) {
      throw new Error('Invalid segmentNumber: must be a non-negative number');
    }
    
    // CRITICAL: Trust userId param, do NOT re-check auth.currentUser
    if (!userId || typeof userId !== 'string') {
      console.error('[HLS][SERVICE][AUTH] uploadSegment blocked: userId param missing or invalid');
      throw new Error('User must be logged in with valid UID');
    }
    
    console.log('[HLS][SERVICE][AUTH] Proceeding with userId from caller:', userId);
    // ✅ Uses userId param throughout
    // ...
  }
}
```

**Called from:** `LiveStreamScreen.js:455`
```javascript
await HLSLiveStreamServiceInstance.uploadSegment(
  streamId,
  videoUri,
  segmentNumber,
  uid  // ✅ PASSES uid from useAuth()
);
```

---

## 6. Firestore Rules Analysis

### Current Rule for Comments (Line 54-64)

```plaintext
match /comments/{commentId} {
  allow read: if true;
  
  allow create: if isAuthenticated()
    && isOwner(request.resource.data.userId)
    && isValidString(request.resource.data.content, 1000)
    && request.resource.data.userId == request.auth.uid;
    //                                  ^^^^^^^^^^^^^^^^
    //                    ❌ THIS REQUIRES Firebase Auth UID
  
  allow update, delete: if isAuthenticated()
    && isOwner(resource.data.userId);
}
```

### The Problem

**Firestore Security Rules ONLY understand:**
- `request.auth.uid` - Firebase Auth UID (or custom token UID)
- `request.auth.token.*` - Claims from Firebase Auth token

**They DO NOT understand:**
- Cognito UIDs
- Any other auth system unless mapped via custom token

### What Happens

```
Client writes comment with:
  userId: "eu-west-2:abc123..."  (Cognito UID)
  content: "Hello world"

Firestore checks:
  isAuthenticated() → request.auth != null
                    → FALSE (no Firebase auth token)
  
  Result: ❌ PERMISSION DENIED
```

**BUT:** The error never reaches this point because the service throws first at line 799.

---

## 7. The Real Problem (Confirmed)

### Root Cause Chain

```
1. App uses Cognito as primary auth
   ↓
2. useAuth() hook returns Cognito uid
   ↓
3. LiveStreamScreen has uid but doesn't pass it
   ↓
4. HLSLiveStreamService.addComment() checks auth.currentUser (Firebase)
   ↓
5. auth.currentUser is null (no Firebase sign-in)
   ↓
6. Throws "User must be logged in"
   ↓
7. User sees error, comment never sent
```

### The Fix Requires 3 Parts

**Part 1: Service API** (change method signatures)
- Accept `userId` as explicit parameter
- Don't check `auth.currentUser`

**Part 2: Call Sites** (pass auth state)
- LiveStreamScreen passes `uid` from `useAuth()` to service methods

**Part 3: Firestore Access** (choose one approach)
- **Option A:** Custom token flow (Cognito → custom Firebase token)
- **Option B:** Backend proxy (all writes via API with admin SDK)
- **Option C:** Anonymous Firebase sign-in (for Firestore access only)

---

## 8. Three Real Implementation Paths

### Option A: Custom Token Flow (Most Secure)

**Architecture:**
```
Client (Cognito JWT) → Backend /auth/firebase-token
  ↓
Backend validates Cognito JWT
  ↓
Backend generates: firebase-admin.auth().createCustomToken(cognitoUserId)
  ↓
Client: await signInWithCustomToken(auth, customToken)
  ↓
Now auth.currentUser.uid === cognitoUserId
  ↓
Firestore rules: request.auth.uid (works correctly)
```

**Pros:**
- ✅ Most secure (validates Cognito token server-side)
- ✅ Firestore rules work as expected
- ✅ Can add custom claims (admin, moderator, etc.)

**Cons:**
- ❌ Requires backend endpoint
- ❌ Token refresh complexity
- ❌ Network latency on app start

**Code Example:**

Backend (Node.js + Firebase Admin):
```javascript
// POST /auth/firebase-token
app.post('/auth/firebase-token', async (req, res) => {
  const cognitoToken = req.headers.authorization?.replace('Bearer ', '');
  
  // Validate Cognito JWT
  const cognitoUser = await verifyCognitoToken(cognitoToken);
  
  if (!cognitoUser) {
    return res.status(401).json({ error: 'Invalid Cognito token' });
  }
  
  // Generate Firebase custom token with Cognito UID
  const customToken = await admin.auth().createCustomToken(cognitoUser.sub, {
    cognitoUsername: cognitoUser.username,
    email: cognitoUser.email,
    // Add custom claims here
  });
  
  res.json({ customToken });
});
```

Client (React Native):
```javascript
// In useAuth hook or app initialization
useEffect(() => {
  if (!uid || !isAuthenticated) return;
  
  const syncFirebaseAuth = async () => {
    try {
      // Get custom token from backend
      const response = await fetch(`${API_URL}/auth/firebase-token`, {
        headers: {
          Authorization: `Bearer ${cognitoToken}`
        }
      });
      
      const { customToken } = await response.json();
      
      // Sign into Firebase with custom token
      await signInWithCustomToken(auth, customToken);
      
      console.log('✅ Firebase auth synced:', auth.currentUser.uid);
    } catch (error) {
      console.error('❌ Firebase auth sync failed:', error);
    }
  };
  
  syncFirebaseAuth();
}, [uid, isAuthenticated]);
```

Then service methods can keep checking `auth.currentUser` (will be populated).

---

### Option B: Backend Proxy (Simplest for Live Features)

**Architecture:**
```
Client → POST /api/liveStreams/:id/comments (Cognito JWT)
  ↓
Backend validates JWT
  ↓
Backend: admin.firestore().collection(...).add(...)
  ↓
Firestore rules: allow write: if false; (admin-only)
```

**Pros:**
- ✅ Simplest client code (just HTTP calls)
- ✅ Full control over business logic server-side
- ✅ Easy rate limiting / spam prevention
- ✅ Can moderate comments before posting

**Cons:**
- ❌ Requires backend for every comment/like
- ❌ More latency than direct Firestore
- ❌ Backend becomes bottleneck

**Code Example:**

Backend:
```javascript
// POST /api/liveStreams/:streamId/comments
app.post('/api/liveStreams/:streamId/comments', async (req, res) => {
  const cognitoToken = req.headers.authorization?.replace('Bearer ', '');
  const { content } = req.body;
  
  // Validate Cognito JWT
  const cognitoUser = await verifyCognitoToken(cognitoToken);
  
  if (!cognitoUser) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  // Validate content
  if (!content || content.length > 1000) {
    return res.status(400).json({ error: 'Invalid content' });
  }
  
  // Write using admin SDK (bypasses rules)
  const comment = {
    userId: cognitoUser.sub,
    userName: cognitoUser.username || 'Anonymous',
    userPhotoURL: cognitoUser.picture || null,
    content: content.trim(),
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    likes: 0,
    isHighlighted: false
  };
  
  await admin.firestore()
    .collection('liveStreams')
    .doc(req.params.streamId)
    .collection('comments')
    .add(comment);
  
  res.json({ success: true });
});
```

Client:
```javascript
// HLSLiveStreamService.js
async addComment(streamId, content, userId) {
  // Instead of writing to Firestore directly, call backend
  const response = await fetch(`${API_URL}/api/liveStreams/${streamId}/comments`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${cognitoToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ content })
  });
  
  if (!response.ok) {
    throw new Error('Failed to add comment');
  }
  
  return response.json();
}
```

Firestore rules:
```plaintext
// Lock down writes to admin-only
match /liveStreams/{streamId}/comments/{commentId} {
  allow read: if true;
  allow write: if false; // Only backend (admin SDK) can write
}
```

---

### Option C: Service Layer Fix + Anonymous Firebase Auth (Quick Fix)

**Architecture:**
```
App start → signInAnonymously(auth)
  ↓
auth.currentUser.uid = "firebase-anon-uid"
  ↓
Service methods use auth.currentUser (now populated)
  ↓
Store Cognito UID in comment.userId field
  ↓
Firestore rules: trust userId field (risky) OR use custom claims
```

**Pros:**
- ✅ Quick to implement
- ✅ No backend required
- ✅ Minimal code changes

**Cons:**
- ❌ Two separate UIDs (Firebase anon + Cognito)
- ❌ Hard to map users across systems
- ❌ Rules can't validate userId matches auth
- ⚠️ Security risk if rules trust user-supplied fields

**Code Example:**

Client:
```javascript
// In App.js or useAuth hook
useEffect(() => {
  const ensureFirebaseAuth = async () => {
    if (!auth.currentUser) {
      console.log('🔐 Signing into Firebase anonymously for Firestore access');
      await signInAnonymously(auth);
      console.log('✅ Firebase anonymous auth:', auth.currentUser.uid);
    }
  };
  
  ensureFirebaseAuth();
}, []);
```

Service (updated):
```javascript
async addComment(streamId, content, cognitoUserId, userName, userPhotoURL) {
  // Firebase auth is now populated (anonymous)
  if (!auth.currentUser) {
    throw new Error('Firebase auth not initialized');
  }
  
  const comment = {
    userId: cognitoUserId,  // Store Cognito UID in field
    firebaseUid: auth.currentUser.uid,  // Store Firebase anon UID
    userName: userName || 'Anonymous',
    userPhotoURL: userPhotoURL || null,
    content: content.trim(),
    timestamp: serverTimestamp(),
    likes: 0,
    isHighlighted: false
  };
  
  await db.collection('liveStreams').doc(streamId).collection('comments').add(comment);
}
```

Firestore rules (RISKY):
```plaintext
// WARNING: This trusts user-supplied userId field
match /liveStreams/{streamId}/comments/{commentId} {
  allow read: if true;
  
  // Allow any authenticated user to write
  // Can't validate userId matches because it's from different system
  allow create: if isAuthenticated()
    && request.resource.data.userId is string
    && request.resource.data.userId.size() > 0
    && isValidString(request.resource.data.content, 1000);
  
  // Delete only if Firebase UID matches (not Cognito UID)
  allow delete: if isAuthenticated()
    && resource.data.firebaseUid == request.auth.uid;
}
```

---

## 9. Recommended Path Forward

### My Recommendation: **Option B (Backend Proxy)** for production

**Why:**
1. **Security:** Full control over validation, rate limiting, moderation
2. **Simplicity:** No complex token mapping or dual-auth systems
3. **Scalability:** Easy to add features (AI moderation, profanity filter, etc.)
4. **Auditability:** All writes logged server-side
5. **Flexibility:** Can switch auth providers without client changes

**Implementation Plan:**

**Phase 1: Backend API** (2-3 hours)
- Create POST `/api/liveStreams/:id/comments` endpoint
- Validate Cognito JWT
- Write using Firebase Admin SDK
- Add rate limiting (max 10 comments/min per user)

**Phase 2: Update Service Layer** (1 hour)
- Update `HLSLiveStreamService.addComment()` to call backend
- Update `addLike()` similarly
- Keep `subscribeToComments()` as-is (reads are direct)

**Phase 3: Update Call Sites** (30 min)
- Pass `cognitoToken` to service methods
- Add error handling for network failures

**Phase 4: Firestore Rules** (15 min)
- Lock comments to admin-only writes
- Keep reads open

**Phase 5: Testing** (1-2 hours)
- Test comment posting
- Test rate limiting
- Test error cases

**Total Time:** 5-7 hours (realistic, not fantasy)

---

## 10. Comparison of All Options

| Aspect | Option A (Custom Token) | Option B (Backend Proxy) | Option C (Anon + Service Fix) |
|--------|------------------------|-------------------------|------------------------------|
| **Security** | ⭐⭐⭐⭐⭐ Excellent | ⭐⭐⭐⭐⭐ Excellent | ⭐⭐ Poor (trusts client) |
| **Complexity** | ⭐⭐⭐ Medium | ⭐⭐⭐⭐ Low | ⭐⭐⭐⭐⭐ Very Low |
| **Backend Required** | ✅ Yes (token endpoint) | ✅ Yes (full API) | ❌ No |
| **Latency** | ⭐⭐⭐⭐ Low (direct Firestore) | ⭐⭐⭐ Medium (API hop) | ⭐⭐⭐⭐⭐ Very Low |
| **Scalability** | ⭐⭐⭐⭐ Good | ⭐⭐⭐⭐⭐ Excellent | ⭐⭐⭐ Fair |
| **Rate Limiting** | ⭐⭐ Hard (Firestore rules) | ⭐⭐⭐⭐⭐ Easy (backend) | ⭐ Very Hard |
| **Moderation** | ⭐⭐ Hard | ⭐⭐⭐⭐⭐ Easy | ⭐ Very Hard |
| **Auditability** | ⭐⭐⭐ Fair | ⭐⭐⭐⭐⭐ Excellent | ⭐⭐ Poor |
| **UID Consistency** | ⭐⭐⭐⭐⭐ Perfect | ⭐⭐⭐⭐⭐ Perfect | ⭐ Poor (two UIDs) |
| **Implementation Time** | 4-6 hours | 5-7 hours | 2-3 hours |

---

## 11. Files That Need Changes

### For Option A (Custom Token)

**Backend:**
- NEW: `functions/src/auth/firebaseToken.js` (custom token generator)
- UPDATE: `functions/src/index.js` (expose endpoint)

**Client:**
- UPDATE: `src/hooks/useCommon.js` (add Firebase auth sync)
- NO CHANGE: Service layer (keep auth.currentUser checks)
- NO CHANGE: Call sites
- NO CHANGE: Firestore rules

### For Option B (Backend Proxy) ⭐ RECOMMENDED

**Backend:**
- NEW: `functions/src/api/liveStreamComments.js` (comment API)
- NEW: `functions/src/api/liveStreamLikes.js` (like API)
- NEW: `functions/src/middleware/verifyCognito.js` (JWT validator)
- UPDATE: `functions/src/index.js` (expose endpoints)

**Client:**
- UPDATE: `src/services/HLSLiveStreamService.js` (lines 796-825, 872-920)
  - `addComment()` - call backend instead of Firestore
  - `addLike()` - call backend instead of Firestore
  - `toggleLike()` - call backend instead of Firestore
- UPDATE: `src/screens/LiveStreamScreen.js` (lines 580-588, 552-577)
  - Pass Cognito token to service methods
- UPDATE: `firestore.rules` (lines 54-64)
  - Lock comments/likes to admin-only writes

### For Option C (Quick Fix)

**Client:**
- UPDATE: `App.js` or `src/hooks/useCommon.js` (add anonymous sign-in)
- UPDATE: `src/services/HLSLiveStreamService.js` (accept userId params)
- UPDATE: `src/screens/LiveStreamScreen.js` (pass uid to methods)
- UPDATE: `firestore.rules` (relax rules - RISKY)

---

## 12. What I Need to Proceed

**To implement Option B (recommended):**

1. ✅ Confirmation you want Option B
2. ❓ Do you have a backend already? (Firebase Functions / Node.js / etc)
3. ❓ Do you have Cognito JWT verification setup?
4. ❓ API URL / base path preferences?

**To implement Option A:**

1. ✅ Confirmation you want Option A
2. ❓ Backend framework preference
3. ❓ Token refresh strategy

**To implement Option C (not recommended):**

1. ⚠️ Acknowledgment of security risks
2. ✅ Just say "quick fix"

---

## 13. Summary

### ✅ Diagnosis Confirmed
- Error: "User must be logged in" at line 799 of HLSLiveStreamService.js
- Root cause: Cognito primary auth + Firebase service dependency
- Affects: Comments, likes, and any other auth.currentUser checks

### ❌ Original Audit Was Wrong About
- Firestore rules can't be "relaxed" to accept Cognito UIDs directly
- Time estimates were fantasy
- Didn't provide proof or implementation options

### ✅ This Analysis Provides
- Exact error locations (grep results)
- Complete call chain trace
- Three real implementation paths
- Security analysis of each option
- Realistic time estimates
- File-by-file change list

---

**Ready for your green light on which option to implement.**
