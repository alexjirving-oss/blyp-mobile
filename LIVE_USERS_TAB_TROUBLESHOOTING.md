# 🔍 Live Users Tab Troubleshooting Guide

## Issue: Live users not appearing in list

### Step 1: Check Console Logs

When you open the Live tab, you should see these logs in sequence:

```
📡 LiveUsersTab: Setting up live users subscription
📊 LiveUsersTab: Received X live users
📊 Raw users array: [...]
  User 1: { id: "...", displayName: "...", ... }
```

### Diagnostic Flow:

#### Case A: See "Received 0 live users"
**Problem:** No users have `status: "live"` in Firestore  
**Solution:**
1. Start a stream on Device A
2. Check console for: `✅ User status set to "live"`
3. Open Firebase Console → Firestore → `/users/{uid}`
4. Verify: `status: "live"` and `currentStreamId: "xxx"`

#### Case B: See "Received 1+ live users" but empty state shows
**Problem:** Array has users but `liveUsers.length` evaluates to 0  
**Check:** Look at the "Raw users array" log
- If array is empty `[]` → State not updating
- If array has data → State update issue

**Solution:**
```javascript
// Add to useEffect in LiveUsersTab
console.log('Setting state with users:', users);
setLiveUsers([...users]); // Force new array reference
```

#### Case C: See "Received 1+ live users" AND "Rendering FlatList"
**Problem:** FlatList is rendering but items invisible  
**Possible causes:**
1. Safe area padding pushed content off screen
2. FlatList height is 0
3. Items rendering but transparent

**Solution:**
```javascript
// Temporarily remove safe area padding
contentContainerStyle={styles.listContainer} // Remove insets
```

#### Case D: No logs at all
**Problem:** Component not mounting or subscription failing  
**Check:**
1. Is ChatListScreen actually showing LiveUsersTab?
2. Is import correct: `import LiveUsersTab from '../components/LiveUsersTab'`
3. Is there an error earlier in the render?

**Solution:**
```javascript
// Add at top of LiveUsersTab component
console.log('🚀 LiveUsersTab component mounted');
```

---

## Step 2: Verify Broadcaster Status

On Device A (broadcaster), after starting stream:

### Check Console:
```
✅ Stream created: abc123
✅ User status set to "live" in Firestore
```

### Check Firebase Console:
1. Go to Firestore
2. Navigate to `/users/{broadcaster-uid}`
3. Verify fields:
   ```
   status: "live"
   currentStreamId: "abc123"
   displayName: "YourName"
   photoURL: "https://..." or null
   ```

If any field is missing → Profile creation failed

---

## Step 3: Test Firestore Query

Run this in Firebase Console → Firestore → "Start collection query":

```
Collection: users
Filters: status == live
```

**Expected:** Should return documents where status is "live"  
**If empty:** No users are live OR query syntax issue

---

## Step 4: Test Navigation

If list shows but tapping does nothing:

### Add log to onPress:
```javascript
onPress={() => {
  console.log('🎯 Card tapped!');
  console.log('  Item data:', item);
  console.log('  Navigating with params:', {
    mode: "viewer",
    hostUid: item.id,
    streamId: item.currentStreamId,
    displayName: item.displayName,
  });
  navigation.navigate("LiveStreamScreen", { ... });
}}
```

### Check LiveStreamScreen:
```
📺 LiveStreamScreen mode: {
  mode: 'viewer',
  isHost: false,
  isViewer: true,
  hostUid: 'user123',
  routeStreamId: 'stream456'
}
```

If you see `mode: undefined` → Navigation params not passed correctly

---

## Step 5: Roll Back Test

### Minimal Working Version

If nothing works, try this ultra-simple version:

```javascript
export default function LiveUsersTab() {
  const [liveUsers, setLiveUsers] = useState([]);
  const navigation = useNavigation();

  useEffect(() => {
    const unsub = subscribeToLiveUsers((users) => {
      console.log('Got users:', users);
      setLiveUsers(users);
    });
    return unsub;
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: '#1a1a2e' }}>
      <FlatList
        data={liveUsers}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={{
              padding: 20,
              backgroundColor: '#fff',
              margin: 10,
              borderRadius: 10,
            }}
            onPress={() => {
              console.log('Tapped:', item.displayName);
              navigation.navigate("LiveStreamScreen", {
                mode: "viewer",
                hostUid: item.id,
                streamId: item.currentStreamId,
                displayName: item.displayName,
              });
            }}
          >
            <Text>{item.displayName || 'No name'}</Text>
            <Text>Status: {item.status}</Text>
            <Text>Stream: {item.currentStreamId || 'none'}</Text>
          </TouchableOpacity>
        )}
      />
      <Text style={{ color: 'white', padding: 20 }}>
        Users: {liveUsers.length}
      </Text>
    </View>
  );
}
```

This removes:
- ❌ Safe area insets
- ❌ Gradients
- ❌ Complex styling
- ❌ Loading states
- ❌ Empty states

If this works → Something in the fancy UI is breaking it  
If this doesn't work → Core subscription or navigation issue

---

## Step 6: Check Firestore Rules

Make sure authenticated users can read user documents:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

Test with:
```bash
firebase deploy --only firestore:rules
```

---

## Step 7: Network Issues

If subscription never fires:

### Check Firebase Connection:
```javascript
import { getFirestore, doc, getDoc } from 'firebase/firestore';

// Test query
const testConnection = async () => {
  const db = getFirestore();
  const testDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
  console.log('Firebase connected:', testDoc.exists());
};
```

---

## Quick Fixes Checklist

- [ ] Broadcaster has `status: "live"` in Firestore
- [ ] Broadcaster has `currentStreamId` set
- [ ] Broadcaster has `displayName` field
- [ ] Viewer's device is logged in (authenticated)
- [ ] Firestore rules allow reading `/users` collection
- [ ] `subscribeToLiveUsers` function exists and is imported
- [ ] No errors in console
- [ ] Metro bundler restarted with `-c` flag
- [ ] Both devices on same Firebase project

---

## Emergency Rollback

If all else fails, revert to the version that was working:

```bash
git diff src/components/LiveUsersTab.js
git diff src/screens/LiveStreamScreen.js
git checkout src/components/LiveUsersTab.js  # if needed
```

Then re-apply changes one at a time, testing after each change.

---

## Success Indicators

When it's working, you should see:

```
📡 LiveUsersTab: Setting up live users subscription
📊 LiveUsersTab: Received 1 live users
📊 Raw users array: [{"id":"user123","displayName":"Alex",...}]
  User 1: { id: "user123", displayName: "Alex", ... }
✅ LiveUsersTab: Rendering FlatList with 1 users
```

And visually: A card with avatar, name, and "🔴 Live now" badge.

---

**Start with Step 1 console logs and work your way down!** 🔍
