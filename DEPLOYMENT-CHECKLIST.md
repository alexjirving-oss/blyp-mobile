# ✅ DEPLOYMENT CHECKLIST - Live Streaming Feature

Use this checklist to deploy your new live streaming feature to production.

---

## 📋 PRE-DEPLOYMENT CHECKLIST

### ✅ 1. Code Files Verified

- [x] `src/services/HLSLiveStreamService.js` - Created ✓
- [x] `src/components/LiveStreamBroadcaster.js` - Created ✓
- [x] `src/components/LiveStreamViewer.js` - Created ✓
- [x] `src/screens/LiveStreamScreen.js` - Replaced with new version ✓
- [x] `src/examples/LiveStreamIntegrationExamples.js` - Created ✓
- [x] No TypeScript/ESLint errors - Verified ✓

### ✅ 2. Firebase Setup

#### Firestore Rules
- [ ] Open Firebase Console: https://console.firebase.google.com
- [ ] Navigate to: Firestore Database → Rules
- [ ] Copy rules from: `firestore-livestream-rules.txt`
- [ ] Add to existing rules (don't replace everything)
- [ ] Click **Publish**
- [ ] Test: Try creating a test stream document

#### Storage Rules
- [ ] Navigate to: Storage → Rules
- [ ] Copy rules from: `storage-livestream-rules.txt`
- [ ] Add to existing rules (don't replace everything)
- [ ] Click **Publish**
- [ ] Test: Try uploading a test file to `streams/test/test.mp4`

#### Firestore Indexes
- [ ] Navigate to: Firestore Database → Indexes
- [ ] Create composite index:
  - Collection: `liveStreams`
  - Fields: `status (Ascending)`, `type (Ascending)`, `startedAt (Descending)`
- [ ] Wait for index to build (5-10 minutes)

---

## 🧪 TESTING CHECKLIST

### ✅ 3. Local Testing

#### As Broadcaster
- [ ] Run: `npm start`
- [ ] Open app on Android device
- [ ] Navigate to Live Stream screen
- [ ] Enter title: "Test Stream"
- [ ] Enter description: "Testing live streaming"
- [ ] (Optional) Add thumbnail
- [ ] Tap "Go Live"
- [ ] ✓ Camera opens
- [ ] ✓ "LIVE" indicator shows
- [ ] ✓ Segment counter increments (0, 1, 2, 3...)
- [ ] ✓ Recording continues smoothly
- [ ] ✓ Can flip camera
- [ ] ✓ Can tap "End" to stop stream

#### Verify Upload
- [ ] Open Firebase Console → Storage
- [ ] Navigate to: `streams/{yourUserId}/live_{timestamp}/`
- [ ] ✓ See `segment_0.mp4`, `segment_1.mp4`, etc.
- [ ] ✓ Files are ~1MB each
- [ ] ✓ Can download and play segments

#### Verify Firestore
- [ ] Open Firebase Console → Firestore
- [ ] Navigate to: `liveStreams` collection
- [ ] Find your test stream document
- [ ] ✓ See `currentSegment` field incrementing
- [ ] ✓ See `segments.0.url`, `segments.1.url`, etc.
- [ ] ✓ See `viewCount`, `status: "live"`

#### As Viewer
- [ ] Open app on second device (or emulator)
- [ ] Get stream ID from Firestore Console
- [ ] Navigate to: `LiveStream` with `streamId` param
- [ ] ✓ Video player appears
- [ ] ✓ Buffering indicator shows briefly
- [ ] ✓ Video starts playing
- [ ] ✓ Video continues smoothly
- [ ] ✓ Can add comment
- [ ] ✓ Can like stream
- [ ] ✓ View count shows correctly

### ✅ 4. Edge Cases Testing

- [ ] **Network interruption**: Turn off WiFi mid-stream
  - [ ] ✓ Recovers when reconnected
  - [ ] ✓ Viewers can rejoin

- [ ] **Background/Foreground**: Put app in background
  - [ ] ✓ Stream pauses appropriately
  - [ ] ✓ Resumes when app reopens

- [ ] **Multiple viewers**: Join with 3+ devices
  - [ ] ✓ View count accurate
  - [ ] ✓ All viewers see stream
  - [ ] ✓ Comments work for all

- [ ] **Late join**: Start stream, wait 30 seconds, then join
  - [ ] ✓ Viewer can join mid-stream
  - [ ] ✓ Playback starts from current segment

- [ ] **End stream**: Creator taps "End"
  - [ ] ✓ Stream status updates to "ended"
  - [ ] ✓ Viewers see "Stream Ended" message
  - [ ] ✓ View count resets to 0

---

## 🎨 UI INTEGRATION CHECKLIST

### ✅ 5. Add "Go Live" Button

#### Option A: Profile Screen
```javascript
// In ProfileScreen.js
import { GoLiveButton } from './examples/LiveStreamIntegrationExamples';

// Add to render:
<GoLiveButton />
```

- [ ] Added `GoLiveButton` to Profile screen
- [ ] Button is visible and styled correctly
- [ ] Button opens Live Stream screen
- [ ] User can create stream from button

#### Option B: Custom Button
```javascript
<TouchableOpacity
  onPress={() => navigation.navigate('LiveStream', { isCreator: true })}
>
  <Text>Go Live</Text>
</TouchableOpacity>
```

- [ ] Created custom "Go Live" button
- [ ] Added to appropriate screen
- [ ] Navigation works correctly

### ✅ 6. Show Active Streams

#### Option A: Use LiveStreamsFeed Component
```javascript
// In HomeScreen.js
import { LiveStreamsFeed } from './examples/LiveStreamIntegrationExamples';

// Add to render:
<LiveStreamsFeed />
```

- [ ] Added `LiveStreamsFeed` to Home screen
- [ ] Shows active streams
- [ ] Tapping stream opens viewer
- [ ] Updates every 10 seconds

#### Option B: Custom Implementation
- [ ] Created custom UI for active streams
- [ ] Fetches streams using `HLSLiveStreamService.getActiveStreams()`
- [ ] Displays stream info (title, thumbnail, viewers)
- [ ] Navigation to viewer works

---

## 📱 APP BUILD CHECKLIST

### ✅ 7. Android Build Configuration

- [ ] **Permissions in app.json**:
  ```json
  {
    "expo": {
      "plugins": [
        [
          "expo-camera",
          {
            "cameraPermission": "Allow $(PRODUCT_NAME) to access your camera for live streaming."
          }
        ]
      ]
    }
  }
  ```

- [ ] **Test build locally**:
  ```powershell
  npx expo prebuild --clean
  ```

- [ ] **Create development build**:
  ```powershell
  eas build --profile development --platform android
  ```

- [ ] **Test on real device**: Install and test full flow

### ✅ 8. Performance Optimization

- [ ] **Video quality**: Adjust based on target audience network
  - Current: 720p (good for most)
  - Consider: 480p for slower networks
  - High-end: 1080p for premium experience

- [ ] **Segment duration**: Optimize for latency vs. cost
  - Current: 3 seconds (good balance)
  - Lower latency: 2 seconds (higher cost)
  - Lower cost: 5 seconds (higher latency)

- [ ] **Cleanup strategy**: Auto-delete old segments
  - Current: After 1 hour
  - Consider: Based on storage budget

---

## 🔒 SECURITY CHECKLIST

### ✅ 9. Firebase Security

- [ ] **Firestore rules deployed**: ✓
- [ ] **Storage rules deployed**: ✓
- [ ] **Test unauthorized access**:
  - [ ] Try to create stream without auth → Blocked ✓
  - [ ] Try to update other user's stream → Blocked ✓
  - [ ] Try to delete other user's stream → Blocked ✓
  - [ ] Can read public streams → Allowed ✓

### ✅ 10. Content Moderation

- [ ] **Comment moderation**:
  - [ ] Add profanity filter (optional)
  - [ ] Add report comment feature (recommended)
  - [ ] Add block user feature (recommended)

- [ ] **Stream moderation**:
  - [ ] Add report stream feature (recommended)
  - [ ] Add admin dashboard to review reports (optional)

---

## 📊 MONITORING CHECKLIST

### ✅ 11. Analytics Setup

- [ ] **Track stream events**:
  - [ ] Stream started
  - [ ] Stream ended
  - [ ] Stream duration
  - [ ] Peak viewers
  - [ ] Total views

- [ ] **Track user behavior**:
  - [ ] Time spent watching
  - [ ] Comments posted
  - [ ] Likes given
  - [ ] Streams created

### ✅ 12. Error Tracking

- [ ] Set up error reporting (Sentry, Firebase Crashlytics)
- [ ] Monitor these specific errors:
  - [ ] Camera permission denied
  - [ ] Upload failures
  - [ ] Playback errors
  - [ ] Network timeouts

---

## 💰 COST MONITORING

### ✅ 13. Firebase Budget Alerts

- [ ] Open Firebase Console → Settings → Usage and Billing
- [ ] Set up budget alerts:
  - [ ] Warning at 50% of budget
  - [ ] Warning at 80% of budget
  - [ ] Email notifications enabled

- [ ] Monitor costs weekly:
  - [ ] Storage: $0.026/GB/month
  - [ ] Bandwidth: $0.12/GB
  - [ ] Firestore reads: $0.06/100k
  - [ ] Firestore writes: $0.18/100k

---

## 🚀 PRODUCTION DEPLOYMENT

### ✅ 14. Final Pre-Launch Checks

- [ ] All tests passing ✓
- [ ] Firebase rules deployed ✓
- [ ] UI integrated ✓
- [ ] Error handling tested ✓
- [ ] Performance acceptable ✓
- [ ] Security verified ✓

### ✅ 15. Build for Production

> HISTORICAL ONLY - NON-CANONICAL - DO NOT USE FOR RELEASE.
> The only valid Android Play-upload AAB release path is:
> `powershell -NoProfile -ExecutionPolicy Bypass -File .\\tools\\release\\BUILD_RELEASE_CANDIDATE.ps1 -ExpectedVersionCode <versionCode>`

```powershell
# Canonical Android Play-upload AAB build
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\release\BUILD_RELEASE_CANDIDATE.ps1 -ExpectedVersionCode <versionCode>

# Optional submit after canonical build completes
eas submit --platform android --profile production
```

- [ ] Production build created
- [ ] Installed on test device
- [ ] Full flow tested on production build
- [ ] No crashes or errors

### ✅ 16. Google Play Store Submission

#### App Content Rating
- [ ] Does your app allow user-generated content? **YES**
- [ ] Does it include live streaming? **YES**
- [ ] Is there content moderation? **YES** (add report feature if needed)

#### Privacy Policy
- [ ] Update privacy policy to mention:
  - [ ] Live streaming feature
  - [ ] Camera and microphone usage
  - [ ] User-generated content storage
  - [ ] Firebase data processing

#### Screenshots
- [ ] Screenshot of "Go Live" setup screen
- [ ] Screenshot of active broadcast
- [ ] Screenshot of viewer watching stream
- [ ] Screenshot of comments section

#### App Description
- [ ] Mention live streaming feature
- [ ] Highlight real-time interaction
- [ ] Mention content moderation

### ✅ 17. Submit App

- [ ] Upload APK/AAB to Google Play Console
- [ ] Fill in all required information
- [ ] Submit for review
- [ ] Wait 2-7 days for approval

---

## 📋 POST-LAUNCH CHECKLIST

### ✅ 18. Monitor Initial Launch

First 24 hours:
- [ ] Check for crashes in Firebase Crashlytics
- [ ] Monitor Firebase costs
- [ ] Check user feedback/reviews
- [ ] Test with real users

First week:
- [ ] Analyze streaming metrics
- [ ] Review viewer retention
- [ ] Check average stream duration
- [ ] Monitor bandwidth costs

### ✅ 19. User Feedback

- [ ] Set up in-app feedback form
- [ ] Monitor app store reviews
- [ ] Track feature requests
- [ ] Identify pain points

### ✅ 20. Optimization

Based on metrics:
- [ ] Adjust video quality if needed
- [ ] Optimize segment duration
- [ ] Improve UI based on feedback
- [ ] Add requested features

---

## 🎉 LAUNCH COMPLETE!

Congratulations! Your live streaming feature is live!

### Next Steps:
1. ✅ Monitor performance
2. ✅ Gather user feedback
3. ✅ Iterate and improve
4. ✅ Add advanced features (filters, effects, etc.)

### Advanced Features to Consider:
- [ ] Beauty filters and effects
- [ ] Screen recording mode
- [ ] Multi-camera support
- [ ] Stream scheduling
- [ ] VOD (replay streams)
- [ ] Monetization (super chats, subscriptions)
- [ ] Analytics dashboard
- [ ] Moderation tools

---

**🚀 You're live! Happy streaming!**
