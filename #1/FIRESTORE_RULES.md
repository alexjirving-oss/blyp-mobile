# Firestore Security Rules for Followers Feature

To enable the followers functionality, update your Firestore security rules to include these rules:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // Users collection - allow users to read and write their own profile
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
      allow read: if request.auth != null; // Allow other users to read profiles
      
      // Followers subcollection - allow users to manage their own followers/following
      match /followers/{followerId} {
        allow read: if request.auth != null;
        allow write: if request.auth != null && (
          // User can add/remove themselves as a follower
          request.auth.uid == followerId ||
          // User can manage their own followers list
          request.auth.uid == userId
        );
      }
      
      // Following subcollection - allow users to manage who they follow
      match /following/{followingId} {
        allow read: if request.auth != null;
        allow write: if request.auth != null && (
          // User can manage their own following list
          request.auth.uid == userId ||
          // The followed user can remove themselves from following list
          request.auth.uid == followingId
        );
      }
    }
    
    // Posts collection - existing rules (add your existing post rules here)
    match /posts/{postId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null && request.auth.uid == resource.data.userId;
      allow update, delete: if request.auth != null && request.auth.uid == resource.data.userId;
    }
    
    // Activities collection (if you have activity tracking)
    match /activities/{activityId} {
      allow read: if request.auth != null && request.auth.uid == resource.data.userId;
      allow create: if request.auth != null;
    }
  }
}
```

## How to Apply These Rules:

1. Go to your Firebase Console
2. Navigate to Firestore Database
3. Click on the "Rules" tab
4. Replace your existing rules with the rules above
5. Publish the changes

## Rule Explanation:

- **Users Collection**: Users can read any profile but only write to their own
- **Followers Subcollection**: Both the follower and the user being followed can manage follower relationships
- **Following Subcollection**: Users can manage their own following list
- **Security**: All operations require authentication
- **Flexibility**: Allows for mutual management of follow relationships

These rules ensure that:
- Only authenticated users can access the data
- Users can follow/unfollow others
- Users can see who follows them
- Users can manage their own followers and following lists
- The system is secure against unauthorized access