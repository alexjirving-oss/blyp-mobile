# Firebase Security Rules Setup

## Problem
You're getting "Missing or insufficient permissions" errors when trying to like posts because Firebase security rules need to be configured.

## Solution
I've created the necessary Firebase security rules files. You need to deploy them to your Firebase project.

## Files Created
- `firestore.rules` - Database security rules that allow like functionality
- `firebase.json` - Firebase configuration file
- `storage.rules` - Storage security rules for media uploads

## Deploy the Rules

1. **Install Firebase CLI** (if not already installed):
   ```bash
   npm install -g firebase-tools
   ```

2. **Login to Firebase**:
   ```bash
   firebase login
   ```

3. **Initialize Firebase in your project** (if not already done):
   ```bash
   firebase init
   ```
   - Select your existing Firebase project (blyp-master)
   - Choose Firestore and Storage when prompted
   - Use the existing rule files when asked

4. **Deploy the security rules**:
   ```bash
   firebase deploy --only firestore:rules,storage
   ```

## What the Rules Allow

### Firestore Rules:
- ✅ Anyone can read posts
- ✅ Users can create/edit/delete their own posts  
- ✅ **Users can like/unlike any post** (updates `likes` count and `likedBy` array)
- ✅ Secure validation ensures users can only add/remove themselves from likes

### Storage Rules:
- ✅ Anyone can read uploaded media
- ✅ Authenticated users can upload media

## After Deployment
Once you deploy these rules, the like functionality will work without permission errors!

## Alternative: Quick Fix via Firebase Console
If you can't use CLI right now, you can copy the contents of `firestore.rules` and paste them directly in the Firebase Console:
1. Go to Firebase Console → Firestore Database → Rules
2. Replace the existing rules with the content from `firestore.rules`
3. Publish the rules