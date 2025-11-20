# 🔐 Firebase Security Rules - Quick Reference

## Firestore Collections & Access

| Collection | Path | Read | Write |
|------------|------|------|-------|
| 👤 Users | `users/{userId}` | Anyone | Owner only |
| 👥 Followers | `users/{userId}/followers/{id}` | Anyone | Auth users |
| 👥 Following | `users/{userId}/following/{id}` | Anyone | Owner only |
| 💎 Gems | `gems/{userId}` | Owner only | Owner only |
| 💰 Wallets | `wallets/{userId}` | Owner only | Owner only |
| 📝 Transactions | `transactions/{txId}` | Owner only | Create only |
| 📱 Posts | `posts/{postId}` | Anyone | Owner only |
| 🎥 Streams | `streams/{streamId}` | Anyone | Host only |
| 💬 Stream Comments | `streams/{id}/comments/{cid}` | Anyone | Auth users |
| 🎬 Stream Segments | `streams/{id}/segments/{sid}` | Anyone | Host only |
| 💬 Chat Rooms | `chatRooms/{roomId}` | Participants | Participants |
| 💬 Chat Messages | `chatMessages/{msgId}` | Participants | Sender only |
| ⚙️ App Config | `appConfig/{configId}` | Anyone | Admin only |

## Storage Paths & Limits

| Path | Access | Max Size |
|------|--------|----------|
| `profiles/{userId}/*` | Owner writes, Public reads | 10 MB |
| `posts/{userId}/{postId}/*` | Owner writes, Public reads | 100 MB |
| `streams/{userId}/**` | Owner writes, Public reads | No limit |
| `chat/{userId}/{chatId}/*` | Owner writes, Auth reads | 100 MB |
| `voicememos/{userId}/*` | Owner writes, Auth reads | 50 MB |
| `uploads/{userId}/**` | Owner writes, Public reads | 100 MB |

## Common Patterns

### Check if user owns a document
```javascript
function isOwner(userId) {
  return request.auth.uid == userId;
}
```

### Check if user is authenticated
```javascript
function signedIn() {
  return request.auth != null;
}
```

### Check file size
```javascript
function isValidSize(maxMB) {
  return request.resource.size < maxMB * 1024 * 1024;
}
```

## Deployment Commands

```bash
# Deploy only Firestore rules
firebase deploy --only firestore:rules

# Deploy only Storage rules
firebase deploy --only storage

# Deploy both
firebase deploy --only firestore:rules,storage
```

## Testing Tips

1. **Test in Firebase Console**: Firestore → Rules → Simulator
2. **Check your app logs**: Look for "permission-denied" errors
3. **Monitor Usage**: Firebase Console → Usage tabs

## Common Fixes

### Permission Denied on Gems
✅ Fixed: `gems/{userId}` requires `request.auth.uid == userId`

### Permission Denied on Balance/Wallet
✅ Fixed: `wallets/{userId}` requires `request.auth.uid == userId`

### Permission Denied on Posts
✅ Fixed: Can read all, but only owner can write

### Permission Denied on Streams
✅ Fixed: Can read all, but only host can create/update/delete

## Quick Verification

Run this in your app console:
```javascript
// Test gems access
const gems = await getDoc(doc(db, 'gems', currentUser.uid));
console.log('Gems:', gems.data());

// Test wallet access
const wallet = await getDoc(doc(db, 'wallets', currentUser.uid));
console.log('Wallet:', wallet.data());

// Test posts read
const posts = await getDocs(query(collection(db, 'posts'), limit(5)));
console.log('Posts:', posts.size);
```

## Need Help?

1. Check `FIREBASE_SECURITY_COMPLETE.md` for full details
2. Check `FIRESTORE_COLLECTIONS_ANALYSIS.md` for collection paths
3. Check Firebase Console → Rules tab for deployed rules
4. Check Firebase Console → Usage tab for errors

---

**Status**: ✅ All rules deployed and active!
**Last Updated**: Just now
**Collections Secured**: 10+ collections
**Storage Paths**: 6+ paths with size limits
