# Firebase Rules Review (Staged)

Date: 2025-10-31

This file proposes rule improvements for Firestore and Storage based on current usage. Do not deploy blindly — validate with the provided test scripts in `scripts/`.

## Firestore (high-level)
- Streams collection
  - Path: `streams/{streamId}`
  - Access:
    - Read: public (viewers)
    - Write: hostUid only for their stream document
  - Messages subcollection: `streams/{streamId}/messages/{msgId}`
    - Create: authenticated users
    - Read: public
    - Constraints: text length <= 500, createdAt server timestamp

Suggested rules skeleton:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /streams/{streamId} {
      allow read: if true;
      allow write: if request.auth != null && request.auth.uid == resource.data.hostUid;

      match /messages/{msgId} {
        allow read: if true;
        allow create: if request.auth != null &&
          request.resource.data.text is string &&
          request.resource.data.text.size() <= 500 &&
          request.resource.data.createdAt == request.time;
      }
    }
  }
}
```

## Storage
- Paths: `users/{uid}/media/...`, `streams/{streamId}/...`
- Access: Only the owner (uid) can write under their space; read rules per visibility.

Suggested rules skeleton:
```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /users/{uid}/{allPaths=**} {
      allow write: if request.auth != null && request.auth.uid == uid;
      allow read: if request.auth != null && (request.auth.uid == uid || resource.metadata.visibility == 'public');
    }
  }
}
```

## Indexes
- Verify composite indexes for any `where(...).orderBy(...).limit(...)` queries in feed and live user lists.

## Validation
- Use `npm run test:rules` to execute local emulated tests in `scripts/`.
