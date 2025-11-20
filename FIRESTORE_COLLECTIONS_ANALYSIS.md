# Firestore Collections Analysis

## Collections Used in the App

Based on code analysis, here are all the Firestore collections being used:

### 1. **users** (Root collection)
- Path: `users/{userId}`
- Used for: User profile data
- Access: Each user should read/write their own document

#### Sub-collections under users:
- **users/{userId}/followers** - List of user's followers
- **users/{userId}/following** - List of users being followed
- **users/{userId}/gems** - User's gem data (if nested)
- **users/{userId}/balance** - User's balance data (if nested)
- **users/{userId}/dailyReward** - Daily reward claim data (if nested)

### 2. **gems** (Root collection)
- Path: `gems/{userId}`
- Used for: User gem balances
- Service: `GemService.js`
- Access: Each user should read/write their own gem document

### 3. **wallets** (Root collection)
- Path: `wallets/{userId}`
- Used for: Blypcoin balance tracking
- Service: `BlypCoinService.js`
- Access: Each user should read/write their own wallet

### 4. **transactions** (Root collection)
- Path: `transactions/{transactionId}`
- Used for: Blypcoin transaction history
- Access: Users should only see their own transactions

### 5. **posts** (Root collection)
- Path: `posts/{postId}`
- Used for: User posts/content
- Access: All users can read, only post owner can update/delete

### 6. **streams** (Root collection)
- Path: `streams/{streamId}`
- Used for: Live streaming
- Access: Public read, only host can create/update/delete
- **Already has rules defined**

#### Sub-collections under streams:
- **streams/{streamId}/comments** - Stream comments
- **streams/{streamId}/segments** - Stream segments
- **streams/{streamId}/messages** - Stream messages (already has rules)
- **streams/{streamId}/joinRequests** - Join requests (already has rules)

### 7. **chatRooms** (Root collection)
- Path: `chatRooms/{roomId}`
- Used for: Direct messaging rooms
- Service: `ChatRoomService.js`
- Access: Only participants should access

### 8. **chatMessages** (Root collection)
- Path: `chatMessages/{messageId}`
- Used for: Chat messages
- Service: `ChatRoomService.js`
- Access: Only room participants should access

### 9. **appConfig** (Root collection)
- Path: `appConfig/{configId}`
- Used for: App-wide configuration (feature flags, etc.)
- Access: All users can read, only admins can write

### 10. **liveStreams** (Root collection - if different from streams)
- Path: `liveStreams/{streamId}`
- Used in: `LiveStreamDebugger.js`
- May be duplicate or legacy

## Current Issues

Based on logs mentioning "gems", "balance", "dailyRewards", and "active streams" permission errors, the current rules file is missing:

1. ✅ **streams** - Already defined
2. ❌ **gems** - Missing rules
3. ❌ **wallets** (balance) - Missing rules
4. ❌ **transactions** - Missing rules
5. ❌ **users** - Missing rules
6. ❌ **posts** - Missing rules
7. ❌ **chatRooms** - Missing rules
8. ❌ **chatMessages** - Missing rules
9. ❌ **appConfig** - Missing rules

## Recommended Rules Structure

See the updated `firestore.rules` file for complete security rules.
