# ⚡ AWS AMPLIFY SETUP - 15 MINUTES

## Step 1: Configure Amplify CLI (3 minutes)

Run this command:
```powershell
amplify configure
```

This will:
1. Open AWS Console in your browser
2. Ask you to create an IAM user
3. Give you Access Key ID and Secret Access Key
4. You'll paste those back in the terminal

**IMPORTANT**: When creating IAM user, select "AdministratorAccess-Amplify" policy.

---

## Step 2: Initialize Amplify in Your Project (2 minutes)

```powershell
amplify init
```

Answer the questions:
- **Project name**: blyp-mobile
- **Environment**: dev
- **Default editor**: Visual Studio Code
- **App type**: javascript
- **Framework**: react-native
- **Source directory**: src
- **Distribution directory**: /
- **Build command**: npm run build
- **Start command**: npm start

---

## Step 3: Add Authentication (1 minute)

```powershell
amplify add auth
```

Choose:
- **Default configuration**
- **Sign in with Email**
- **No advanced settings**

---

## Step 4: Add API & Database (2 minutes)

```powershell
amplify add api
```

Choose:
- **GraphQL**
- **API name**: blypapi
- **Authorization**: Amazon Cognito User Pool
- **Schema**: Select "Single object with fields"

Edit the schema that opens (or I'll create it for you):

```graphql
type User @model @auth(rules: [{allow: owner}]) {
  id: ID!
  email: String!
  username: String
  displayName: String
  avatarUrl: String
  bio: String
  blypCoins: Int
  gems: Int
  posts: [Post] @hasMany
}

type Post @model @auth(rules: [{allow: public, operations: [read]}, {allow: owner}]) {
  id: ID!
  caption: String
  mediaUrl: String
  mediaType: String
  likes: Int
  shares: Int
  userID: ID! @index(name: "byUser")
  user: User @belongsTo
}

type LiveStream @model @auth(rules: [{allow: public, operations: [read]}, {allow: owner}]) {
  id: ID!
  title: String
  isLive: Boolean
  viewerCount: Int
  streamUrl: String
  userID: ID! @index(name: "byUser")
  user: User @belongsTo
}
```

---

## Step 5: Add Storage (1 minute)

```powershell
amplify add storage
```

Choose:
- **Content (Images, audio, video, etc.)**
- **Resource name**: blypStorage
- **Bucket name**: (accept default)
- **Auth users**: read/write
- **Guest users**: read

---

## Step 6: Deploy Everything (3 minutes)

```powershell
amplify push
```

This will:
- Create your AWS resources
- Generate API code
- Set up authentication
- Create storage bucket

**Wait 2-3 minutes for deployment...**

---

## Step 7: Done! (0 minutes)

Amplify automatically creates `src/aws-exports.js` with all your configuration.

I'll update your app imports to use Amplify instead of Firebase.

---

## Costs

**FREE TIER (12 months):**
- 1,000 monthly active users
- 5GB storage
- 15GB data transfer
- API calls included

**After free tier:**
- ~$0.0055 per monthly active user
- $0.023 per GB storage
- Still very cheap for small apps

---

## Ready to Start?

Run: `amplify configure`

Let me know when it asks you for the Access Keys!

---

## Code Differences: Firebase vs Amplify

### Firebase

```javascript
import { auth } from './src/config/firebase'
signInWithEmailAndPassword(auth, email, password)
```

### Amplify

```javascript
import { Auth } from 'aws-amplify'
Auth.signIn(email, password)
```

---

## File Storage Differences: Firebase vs Amplify

### Firebase

```javascript
// Firebase
uploadBytes(ref(storage, path), file)
```

### Amplify

```javascript
// Amplify
Storage.put(path, file)
```
