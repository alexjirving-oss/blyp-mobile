import React, { useState, useEffect, useCallback, useRef } from 'react';
import BlueScreen from '../ui/BlueScreen';
import { ActivityIndicator, Alert, Animated, FlatList, Image, Platform, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import Icon from '../components/Icon';
import BlypLogo, { BLYP_LOGO_GRADIENT_COLORS } from '../components/BlypLogo';
import HeaderMenuTabs from '../components/HeaderMenuTabs';
import { auth, db, storage, firebaseEnabled } from '../config/firebase';
import { snapData } from '../utils/firestoreSnap';
import { signOut } from 'firebase/auth';
import { subscribeToFollowersCount, subscribeToFollowingCount, getFollowersCount, getFollowingCount } from '../utils/followUtils';
import { COLORS } from '../styles/theme';
import { mediaViewerParams } from '../utils/mediaViewerPlaylist';

// Posts load one page at a time. The first page is live (new posts/likes show
// instantly); older pages are fetched on scroll so a profile shows ALL posts,
// however many there are.
const PROFILE_PAGE_SIZE = 30;

// Merge a freshly-arrived live page into the existing list WITHOUT dropping the
// older pages that pagination already appended (so the grid never snaps back to
// a single page when a like count changes).
function mergeLivePage(prev, livePage) {
  if (!Array.isArray(prev) || prev.length === 0) return livePage;
  const byId = new Map(livePage.map((p) => [p.id, p]));
  const next = [];
  prev.forEach((existing) => {
    const updated = byId.get(existing.id);
    if (updated) {
      next.push(updated);
      byId.delete(existing.id);
    } else {
      next.push(existing);
    }
  });
  livePage.forEach((p) => {
    if (byId.has(p.id)) next.push(p);
  });
  return next;
}

const ProfileScreen = () => {
  const navigation = useNavigation();
  const user = auth.currentUser;
  const [userPosts, setUserPosts] = useState([]);
  const [likedPosts, setLikedPosts] = useState([]);
  const [userProfile, setUserProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedTab, setSelectedTab] = useState('posts'); // 'posts' or 'likes'
  const [profileTab, setProfileTab] = useState('myProfile'); // 'myProfile', 'tab1', 'tab2', 'tab3'
  const [followersCount, setFollowersCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  // Pagination cursors/flags for posts and liked posts.
  const postsCursorRef = useRef(null);
  const postsHasMoreRef = useRef(true);
  const loadingMorePostsRef = useRef(false);
  const likesCursorRef = useRef(null);
  const likesHasMoreRef = useRef(true);
  const loadingMoreLikesRef = useRef(false);

  // Load profile
  useEffect(() => {
    if (!user) return;
    db.collection('users').doc(user.uid).get().then(doc => {
      const pd = snapData(doc);
      if (pd) setUserProfile(pd);
      else setUserProfile({ displayName: user.displayName || 'anonymous', email: user.email, photoURL: user.photoURL, bio: '' });
    }).catch(e => {
      console.log('[PROFILE][ERROR] load profile', e.message);
      setUserProfile({ displayName: user.displayName || 'anonymous', email: user.email, photoURL: user.photoURL, bio: '' });
    });
  }, [user]);

  // Followers count
  useEffect(() => {
    if (!user) return;
    let unsub;
    try { unsub = subscribeToFollowersCount(user.uid, c => setFollowersCount(c)); }
    catch { getFollowersCount(user.uid).then(c => setFollowersCount(c)).catch(() => setFollowersCount(0)); }
    return () => { if (unsub) unsub(); };
  }, [user]);

  // Following count — same graph path as followUtils (users/{uid}/following)
  useEffect(() => {
    if (!user) return;
    let unsub;
    try { unsub = subscribeToFollowingCount(user.uid, c => setFollowingCount(c)); }
    catch { getFollowingCount(user.uid).then(c => setFollowingCount(c)).catch(() => setFollowingCount(0)); }
    return () => { if (unsub) unsub(); };
  }, [user]);

  // User posts subscription — live first page; older pages paginated below.
  useEffect(() => {
    if (!user) return;
    if (!firebaseEnabled) { setLoading(false); setUserPosts([]); return; }
    console.log('[PROFILE] Setting up posts query for userId:', user.uid);
    const unsub = db.collection('posts').where('userId', '==', user.uid).orderBy('date', 'desc').limit(PROFILE_PAGE_SIZE).onSnapshot(
      snap => {
        const docs = snap.docs || [];
        postsCursorRef.current = docs.length ? docs[docs.length - 1] : null;
        postsHasMoreRef.current = docs.length >= PROFILE_PAGE_SIZE;
        const page = docs.map(d => ({ id: d.id, ...d.data() }));
        setUserPosts(prev => mergeLivePage(prev, page));
        setLoading(false);
      },
      err => {
        console.log('[PROFILE][ERROR] posts query', err.message);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [user, firebaseEnabled]);

  // Liked posts subscription — live first page; older pages paginated below.
  useEffect(() => {
    if (!user || !firebaseEnabled) return;
    console.log('[PROFILE] Setting up liked posts query');
    const unsub = db.collection('posts').where('likedBy', 'array-contains', user.uid).orderBy('date', 'desc').limit(PROFILE_PAGE_SIZE).onSnapshot(
      snap => {
        const docs = snap.docs || [];
        likesCursorRef.current = docs.length ? docs[docs.length - 1] : null;
        likesHasMoreRef.current = docs.length >= PROFILE_PAGE_SIZE;
        const page = docs.map(d => ({ id: d.id, ...d.data() }));
        setLikedPosts(prev => mergeLivePage(prev, page));
      },
      err => console.log('[PROFILE][ERROR] liked posts query', err.message)
    );
    return () => unsub();
  }, [user, firebaseEnabled]);

  const loadMorePosts = useCallback(async () => {
    if (loadingMorePostsRef.current || !postsHasMoreRef.current) return;
    if (!user || !firebaseEnabled) return;
    const cursor = postsCursorRef.current;
    if (!cursor) return;
    loadingMorePostsRef.current = true;
    setLoadingMore(true);
    try {
      const snap = await db.collection('posts').where('userId', '==', user.uid)
        .orderBy('date', 'desc').startAfter(cursor).limit(PROFILE_PAGE_SIZE).get();
      const docs = snap.docs || [];
      if (docs.length) postsCursorRef.current = docs[docs.length - 1];
      postsHasMoreRef.current = docs.length >= PROFILE_PAGE_SIZE;
      const older = docs.map(d => ({ id: d.id, ...d.data() }));
      if (older.length) {
        setUserPosts(prev => {
          const have = new Set(prev.map(p => p.id));
          const add = older.filter(p => !have.has(p.id));
          return add.length ? [...prev, ...add] : prev;
        });
      }
    } catch (e) {
      console.log('[PROFILE][ERROR] loadMorePosts', e.message);
    } finally {
      loadingMorePostsRef.current = false;
      setLoadingMore(false);
    }
  }, [user, firebaseEnabled]);

  const loadMoreLikes = useCallback(async () => {
    if (loadingMoreLikesRef.current || !likesHasMoreRef.current) return;
    if (!user || !firebaseEnabled) return;
    const cursor = likesCursorRef.current;
    if (!cursor) return;
    loadingMoreLikesRef.current = true;
    setLoadingMore(true);
    try {
      const snap = await db.collection('posts').where('likedBy', 'array-contains', user.uid)
        .orderBy('date', 'desc').startAfter(cursor).limit(PROFILE_PAGE_SIZE).get();
      const docs = snap.docs || [];
      if (docs.length) likesCursorRef.current = docs[docs.length - 1];
      likesHasMoreRef.current = docs.length >= PROFILE_PAGE_SIZE;
      const older = docs.map(d => ({ id: d.id, ...d.data() }));
      if (older.length) {
        setLikedPosts(prev => {
          const have = new Set(prev.map(p => p.id));
          const add = older.filter(p => !have.has(p.id));
          return add.length ? [...prev, ...add] : prev;
        });
      }
    } catch (e) {
      console.log('[PROFILE][ERROR] loadMoreLikes', e.message);
    } finally {
      loadingMoreLikesRef.current = false;
      setLoadingMore(false);
    }
  }, [user, firebaseEnabled]);

  const handleLogout = async () => {
    Alert.alert('Logout', 'Are you sure you want to logout?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Logout', style: 'destructive', onPress: async () => { try { await signOut(auth); } catch (e) { console.log('logout error', e.message); } } }
    ]);
  };

  const handleDeletePost = (post) => {
    Alert.alert('Delete Post', 'Delete permanently?', [{ text: 'Cancel', style: 'cancel' }, {
      text: 'Delete', style: 'destructive', onPress: async () => {
        try {
          const promises = [];
          if (post.videoUrl) { try { promises.push(storage.refFromURL(post.videoUrl).delete()); } catch { } }
          if (Array.isArray(post.media)) {
            post.media.forEach(m => {
              if (m.url) { try { promises.push(storage.refFromURL(m.url).delete()); } catch { } }
              if (m.thumbnail && m.thumbnail !== m.url) { try { promises.push(storage.refFromURL(m.thumbnail).delete()); } catch { } }
            });
          }
          if (post.thumbnail && !post.media?.some(m => m.thumbnail === post.thumbnail)) {
            try { promises.push(storage.refFromURL(post.thumbnail).delete()); } catch { }
          }
          if (promises.length) await Promise.allSettled(promises);
          await db.collection('posts').doc(post.id).delete();
          Alert.alert('Deleted', 'Post deleted successfully');
        } catch (e) { Alert.alert('Error deleting', e.message); }
      }
    }]);
  };

  const handlePostPress = post =>
    navigation.navigate(
      'MediaViewer',
      mediaViewerParams(post, selectedTab === 'posts' ? userPosts : likedPosts),
    );

  const getPostThumbnail = post => {
    if (post.thumbnail) return post.thumbnail;
    if (post.media?.[0]?.thumbnail) return post.media[0].thumbnail;
    if (post.media?.[0]?.url) return post.media[0].url;
    if (post.videoUrl) return post.videoUrl;
    if (post.imageUrl) return post.imageUrl;
    return 'https://images.unsplash.com/photo-1611162617474-5b21e879e113?w=400&h=400&fit=crop';
  };

  const renderPostItem = ({ item: post }) => {
    const isVideo = post.type === 'video' || post.media?.[0]?.type?.includes('video') || post.videoUrl || post.media?.[0]?.url?.includes('.mp4');
    const thumbnail = getPostThumbnail(post);
    return (
      <TouchableOpacity style={styles.gridItem} onPress={() => handlePostPress(post)} activeOpacity={0.9}>
        <Image source={{ uri: thumbnail }} style={styles.gridImage} resizeMode="cover" />
        {isVideo && (
          <View style={styles.playIconOverlay}>
            <Icon name="play" size={20} color="#fff" />
          </View>
        )}
        <View style={styles.postStats}>
          <View style={styles.statBadge}>
            <Icon name="heart" size={14} color="#fff" />
            <Text style={styles.statText}>{post.likes || 0}</Text>
          </View>
        </View>
        <TouchableOpacity style={styles.deleteIcon} onPress={(e) => { e.stopPropagation(); handleDeletePost(post); }}>
          <Icon name="close-circle" size={24} color="rgba(239,68,68,0.9)" />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  const renderListHeader = () => (
    <>
      {/* Profile Info */}
      <View style={styles.profileSection}>
        <TouchableOpacity onPress={() => navigation.navigate('EditProfile')}>
          <Image
            source={{ uri: user?.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(user?.displayName || 'User')}&size=120&background=a855f7&color=fff&bold=true` }}
            style={styles.avatar}
          />
        </TouchableOpacity>

        <View style={styles.stats}>
          <TouchableOpacity style={styles.statBox} onPress={() => navigation.navigate('Followers', { userId: user.uid, type: 'following' })}>
            <Text style={styles.statValue}>{followingCount}</Text>
            <Text style={styles.statLabel}>Following</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.statBox} onPress={() => navigation.navigate('Followers', { userId: user.uid, type: 'followers' })}>
            <Text style={styles.statValue}>{followersCount}</Text>
            <Text style={styles.statLabel}>Followers</Text>
          </TouchableOpacity>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{userPosts.reduce((a, p) => a + (p.likes || 0), 0)}</Text>
            <Text style={styles.statLabel}>Likes</Text>
          </View>
        </View>

        {userProfile?.bio ? (
          <Text style={styles.bio}>{userProfile.bio}</Text>
        ) : (
          <Text style={styles.bioPlaceholder}>No bio yet</Text>
        )}

        <TouchableOpacity style={styles.editProfileButton} onPress={() => navigation.navigate('EditProfile')}>
          <LinearGradient colors={BLYP_LOGO_GRADIENT_COLORS} style={styles.editProfileGradient}>
            <Icon name="create-outline" size={18} color="#fff" />
            <Text style={styles.editProfileText}>Edit Profile</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tabButton, selectedTab === 'posts' && styles.activeTab]}
          onPress={() => setSelectedTab('posts')}
        >
          <Icon name="grid-outline" size={24} color={selectedTab === 'posts' ? '#FF2D55' : '#A1A1AA'} />
          <Text style={[styles.tabLabel, selectedTab === 'posts' && styles.activeTabLabel]}>Posts</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabButton, selectedTab === 'likes' && styles.activeTab]}
          onPress={() => setSelectedTab('likes')}
        >
          <Icon name="heart-outline" size={24} color={selectedTab === 'likes' ? '#FF2D55' : '#A1A1AA'} />
          <Text style={[styles.tabLabel, selectedTab === 'likes' && styles.activeTabLabel]}>Likes</Text>
        </TouchableOpacity>
      </View>
    </>
  );

  const renderListEmpty = () => {
    if (loading && selectedTab === 'posts') {
      return <View style={styles.emptyState}><Icon name="reload-circle-outline" size={48} color="#FF2D55" /><Text style={styles.emptyText}>Loading...</Text></View>;
    }
    if (!firebaseEnabled) {
      return <View style={styles.emptyState}><Icon name="cloud-offline-outline" size={48} color="#6b7280" /><Text style={styles.emptyText}>Offline mode</Text><Text style={styles.emptySubtext}>Posts unavailable</Text></View>;
    }
    return (
      <View style={styles.emptyState}>
        <Icon name="camera-outline" size={64} color="#6b7280" />
        <Text style={styles.emptyText}>{selectedTab === 'posts' ? 'No posts yet' : 'No liked posts'}</Text>
        <Text style={styles.emptySubtext}>{selectedTab === 'posts' ? 'Create your first post' : 'Like posts to see them here'}</Text>
      </View>
    );
  };

  const displayPosts = selectedTab === 'posts' ? userPosts : likedPosts;

  return (
    <BlueScreen>
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <TouchableOpacity style={styles.menuButton} onPress={() => navigation.openDrawer?.()}>
              <Icon name="menu" size={24} color="#d1d5db" />
            </TouchableOpacity>
            <View style={styles.logoContainer}>
              <BlypLogo useGradientBackground={true} />
            </View>
            <TouchableOpacity style={styles.menuButton} onPress={() => navigation.navigate('Search')}>
              <Icon name="search" size={24} color="#d1d5db" />
            </TouchableOpacity>
          </View>

          {/* Tab Selector */}
          <HeaderMenuTabs
            tabs={[
              { key: 'myProfile', label: 'My Profile' },
              { key: 'tab1', label: '1' },
              { key: 'tab2', label: '2' },
              { key: 'tab3', label: '3' },
            ]}
            activeKey={profileTab}
            onChange={setProfileTab}
          />
        </View>

        <FlatList
          key={selectedTab}
          style={styles.scrollView}
          data={displayPosts}
          renderItem={renderPostItem}
          keyExtractor={i => i.id}
          numColumns={3}
          ListHeaderComponent={renderListHeader}
          ListEmptyComponent={renderListEmpty}
          ListFooterComponent={loadingMore ? <View style={styles.footerLoader}><ActivityIndicator size="small" color="#FF2D55" /></View> : null}
          onEndReached={selectedTab === 'posts' ? loadMorePosts : loadMoreLikes}
          onEndReachedThreshold={1}
          showsVerticalScrollIndicator={false}
          initialNumToRender={15}
          contentContainerStyle={styles.gridContainer}
        />
      </View>
    </BlueScreen>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.pageBackground },
  header: { paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + 8 : 8, paddingBottom: 1, borderBottomWidth: 1, borderBottomColor: '#141418' },
  headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 16 },
  logoContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  menuButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerBalances: { position: 'absolute', left: 56, height: '100%', justifyContent: 'center' },
  tabContainer: { paddingHorizontal: 16, paddingBottom: 12 },
  tabSelector: { position: 'relative', backgroundColor: COLORS.surface, borderRadius: 9999, padding: 4, flexDirection: 'row' },
  tab: { flex: 1, paddingVertical: 6, alignItems: 'center', zIndex: 2 },
  tabText: { color: '#9ca3af', fontSize: 12, fontWeight: '600' },
  activeTabText: { color: '#ffffff' },
  tabIndicator: { position: 'absolute', top: 2, bottom: 2, width: '25%', borderRadius: 9999, zIndex: 1 },
  tabIndicatorGradient: { flex: 1, borderRadius: 9999 },
  scrollView: { flex: 1 },
  profileSection: { alignItems: 'center', paddingVertical: 8, paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: '#141418' },
  avatar: { width: 100, height: 100, borderRadius: 50, borderWidth: 2, borderColor: '#26262C', marginBottom: 16 },
  stats: { flexDirection: 'row', marginBottom: 16, gap: 32 },
  statBox: { alignItems: 'center' },
  statValue: { fontSize: 20, fontWeight: 'bold', color: '#fff', marginBottom: 4 },
  statLabel: { fontSize: 13, color: '#A1A1AA' },
  bio: { fontSize: 14, color: '#E4E4E7', textAlign: 'center', lineHeight: 20, marginBottom: 16, paddingHorizontal: 20 },
  bioPlaceholder: { fontSize: 14, color: '#6b7280', fontStyle: 'italic', marginBottom: 16 },
  editProfileButton: { width: '100%', borderRadius: 12, overflow: 'hidden', marginTop: 8 },
  editProfileGradient: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, gap: 8 },
  editProfileText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  tabBar: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#141418', paddingHorizontal: 16 },
  tabButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14, gap: 6, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  activeTab: { borderBottomColor: '#FF2D55' },
  tabLabel: { fontSize: 14, fontWeight: '600', color: '#A1A1AA' },
  activeTabLabel: { color: '#FF2D55' },
  gridContainer: { paddingTop: 2 },
  gridItem: { flex: 1 / 3, aspectRatio: 1, margin: 1, backgroundColor: '#141418', position: 'relative' },
  gridImage: { width: '100%', height: '100%' },
  playIconOverlay: { position: 'absolute', top: 8, left: 8, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 16, padding: 4 },
  postStats: { position: 'absolute', bottom: 6, left: 6, flexDirection: 'row', gap: 6 },
  statBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 12, paddingHorizontal: 6, paddingVertical: 3, gap: 3 },
  statText: { fontSize: 11, fontWeight: '600', color: '#fff' },
  deleteIcon: { position: 'absolute', top: 6, right: 6, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 12 },
  footerLoader: { paddingVertical: 20, alignItems: 'center', justifyContent: 'center' },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 8, paddingHorizontal: 32 },
  emptyText: { fontSize: 16, fontWeight: '600', color: '#6b7280', marginTop: 12, textAlign: 'center' },
  emptySubtext: { fontSize: 14, color: '#4b5563', marginTop: 6, textAlign: 'center' }
});

export default ProfileScreen;


