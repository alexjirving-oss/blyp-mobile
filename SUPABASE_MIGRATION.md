# 🚀 SUPABASE MIGRATION - 20 MINUTE GUIDE

## Step 1: Create Supabase Project (2 minutes)
1. Go to https://supabase.com/dashboard
2. Click "New Project"
3. Name it "blyp-mobile"
4. Choose a database password (save it!)
5. Select closest region
6. Wait ~30 seconds for project creation

## Step 2: Get Your Keys (1 minute)
1. Go to Project Settings → API
2. Copy **Project URL** (e.g., `https://xxxxx.supabase.co`)
3. Copy **anon public** key
4. Paste both into `src/config/supabase.js`

## Step 3: Set Up Database Tables (3 minutes)
Run these SQL queries in Supabase SQL Editor (Table Editor → SQL Editor):

```sql
-- Users table
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE,
  username TEXT,
  display_name TEXT,
  avatar_url TEXT,
  bio TEXT,
  blyp_coins INTEGER DEFAULT 0,
  gems INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Posts table
CREATE TABLE posts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  caption TEXT,
  media_url TEXT,
  media_type TEXT, -- 'photo' or 'video'
  likes INTEGER DEFAULT 0,
  shares INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Live Streams table
CREATE TABLE live_streams (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  title TEXT,
  is_live BOOLEAN DEFAULT false,
  viewer_count INTEGER DEFAULT 0,
  stream_url TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  ended_at TIMESTAMP
);

-- Followers table
CREATE TABLE followers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  follower_id UUID REFERENCES users(id) ON DELETE CASCADE,
  following_id UUID REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(follower_id, following_id)
);

-- Enable Row Level Security
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE live_streams ENABLE ROW LEVEL SECURITY;
ALTER TABLE followers ENABLE ROW LEVEL SECURITY;

-- Create policies (allows all access for now - tighten later)
CREATE POLICY "Allow all for users" ON users FOR ALL USING (true);
CREATE POLICY "Allow all for posts" ON posts FOR ALL USING (true);
CREATE POLICY "Allow all for streams" ON live_streams FOR ALL USING (true);
CREATE POLICY "Allow all for followers" ON followers FOR ALL USING (true);
```

## Step 4: Set Up Storage (2 minutes)
1. Go to Storage → Create Bucket
2. Name: `media`
3. Set to **Public**
4. Create folders: `posts/`, `avatars/`, `streams/`

## Step 5: Switch Your App (5 minutes)
Files already updated:
- ✅ `src/config/supabase.js` - Created
- ⏳ Just need to update import statements in screens

## Step 6: Test (2 minutes)
1. Run `.\start-app.ps1`
2. Try logging in
3. Try creating a post

---

## Quick API Translation

### Firebase → Supabase

**Authentication:**
```javascript
// Firebase
await signInWithEmailAndPassword(auth, email, password)

// Supabase
await supabase.auth.signInWithPassword({ email, password })
```

**Read Data:**
```javascript
// Firebase
const snapshot = await getDocs(collection(db, 'posts'))

// Supabase
const { data } = await supabase.from('posts').select('*')
```

**Create Data:**
```javascript
// Firebase
await addDoc(collection(db, 'posts'), { title: 'Test' })

// Supabase
await supabase.from('posts').insert({ title: 'Test' })
```

**Upload File:**
```javascript
// Firebase
await uploadBytes(ref(storage, path), file)

// Supabase
await supabase.storage.from('media').upload(path, file)
```

---

## Next Steps After Migration
1. Export Firebase data (optional - start fresh is faster)
2. Update security policies to be more restrictive
3. Remove Firebase dependencies: `npm uninstall firebase`
4. Delete `src/config/firebase.js`

**Total time: ~15-20 minutes** ⚡
