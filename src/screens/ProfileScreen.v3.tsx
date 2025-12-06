/*
  FEATURE: Current user Profile – v3
  SOURCE OF TRUTH: Spec + checklist from BLYP-01 (see implementation command)
  NOTES:
    - Current user only (own profile)
    - Must render under fixed Blyp header
    - Must satisfy P0 acceptance checklist
*/
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, SafeAreaView, ScrollView, TouchableOpacity, Image, ActivityIndicator, RefreshControl, StatusBar, FlatList } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import HeaderContainer from '../components/HeaderContainer';
import BlypLogo from '../components/BlypLogo';
import Icon from '../components/Icon';
import { useAuth } from '../hooks/useCommon';
import { db, firebaseEnabled } from '../config/firebase';
import * as firebaseCfg from '../config/firebase';
import { primeStreamingFlag, isLiveStreamingEnabledAsync } from '../config/StreamingFeatureFlag';

type StatBundle = {
  followers: number;
  following: number;
  likes: number;
  posts: number;
  lives: number;
};

type StatValue = number | null; // null indicates failed load per A2

const safeNumber = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const renderStat = (value: StatValue): string => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    try { return Intl.NumberFormat('en-US').format(value); } catch { return String(value); }
  }
  return '–';
};

const formatCount = (n: number) => {
  try {
    if (!Number.isFinite(n)) return '0';
    return Intl.NumberFormat('en-US').format(n);
  } catch { return String(n ?? 0); }
};

const ProfileScreenV3: React.FC = () => {
  const nav = useNavigation();
  const { user, uid, authReady, loading: authLoading } = useAuth();
  const [profileTab, setProfileTab] = useState<'myProfile' | 'tab1' | 'tab2' | 'tab3'>('myProfile');
  const [activeTab, setActiveTab] = useState('My Profile');
  const [headerHeight, setHeaderHeight] = useState(0);
  const [profile, setProfile] = useState<any>(null);
  const [stats, setStats] = useState<{ followers: StatValue; following: StatValue; likes: StatValue; posts: StatValue; lives: StatValue }>({ followers: 0, following: 0, likes: 0, posts: 0, lives: 0 });
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [userPosts, setUserPosts] = useState<any[]>([]);
  const [loadingPosts, setLoadingPosts] = useState(true);
  const extracting = useRef(false);

  // Ensure streaming flag primed once
  useEffect(() => { try { primeStreamingFlag(); } catch {} }, []);

  // Auth gating: redirect if unauthenticated
  useEffect(() => {
    if (authReady && !authLoading) {
      const isAuthed = !!uid;
      if (!isAuthed) {
        // Redirect to login/onboarding
        try { nav.navigate('Auth' as never); } catch {}
      }
    }
  }, [authReady, authLoading, uid, nav]);

  const onRetry = useCallback(() => {
    setErr(null);
    void loadAll();
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setErr(null);
    loadAll().finally(() => setRefreshing(false));
  }, []);

  const loadAll = useCallback(async () => {
    if (!uid) { setBusy(false); return; }
    if (extracting.current) return;
    extracting.current = true;
    setBusy(true);
    try {
      // Profile basics from single source (users/{uid})
      let basics: any = null;
      try {
        const snap = await db.collection('users').doc(uid).get();
        basics = snap?.data?.() ?? snap?.data?.(); // compat returns like native/web; guard
        if (!basics && snap && 'data' in snap) basics = snap.data();
      } catch {}
      if (!basics) {
        // Fallback to Firebase Auth profile if present
        const fu: any = (firebaseCfg as any)?.auth?.currentUser;
        basics = {
          displayName: fu?.displayName || null,
          photoURL: fu?.photoURL || null,
          handle: null,
          bio: '',
        };
      }
      setProfile(basics);

      // Followers count (each query failure isolated per A2)
      let followers: StatValue = 0;
      let following: StatValue = 0;
      let likes: StatValue = 0;
      let posts: StatValue = 0;
      let lives: StatValue = 0;
      try {
        const fsnap = await db.collection('followers').where('userId','==',uid).get();
        followers = safeNumber(fsnap?.docs?.length ?? 0);
      } catch (e: any) {
        try { console.warn('[PROFILE][WARN] followers load failed', e?.message); } catch {}
        followers = null;
      }
      try {
        const fsnap2 = await db.collection('followers').where('followerId','==',uid).get();
        following = safeNumber(fsnap2?.docs?.length ?? 0);
      } catch (e: any) {
        try { console.warn('[PROFILE][WARN] following load failed', e?.message); } catch {}
        following = null;
      }
      try {
        const ps = await db.collection('posts').where('userId','==',uid).get();
        posts = safeNumber(ps?.docs?.length ?? 0);
        likes = safeNumber((ps?.docs || []).reduce((acc: number, d: any) => {
          const data = typeof d.data === 'function' ? d.data() : d.data;
          const v = safeNumber(data?.likes);
          return acc + v;
        }, 0));
      } catch (e: any) {
        try { console.warn('[PROFILE][WARN] posts/likes load failed', e?.message); } catch {}
        posts = null; likes = null;
      }
      try {
        const ls = await db.collection('liveStreams').where('userId','==',uid).get();
        lives = safeNumber(ls?.docs?.length ?? 0);
      } catch (e: any) {
        try { console.warn('[PROFILE][WARN] lives load failed', e?.message); } catch {}
        lives = null;
      }
      setStats({ followers, following, likes, posts, lives });

      setBusy(false);
      setErr(null);
      // Analytics: profile_view_self
      if (uid) { try { console.log('📈 profile_view_self', { userId: uid, source: 'profile_self', at: new Date().toISOString() }); } catch {} }
    } catch (e: any) {
      setBusy(false);
      setErr('Could not load your profile.');
    } finally {
      extracting.current = false;
    }
  }, [uid]);

  useEffect(() => { if (uid) void loadAll(); }, [uid, loadAll]);

  // Subscribe to user posts (realtime)
  useEffect(() => {
    if (!uid || !firebaseEnabled) {
      setUserPosts([]);
      setLoadingPosts(false);
      return;
    }
    console.log('[PROFILE] Setting up posts subscription for user:', uid);
    setLoadingPosts(true);
    const unsubscribe = db.collection('posts')
      .where('userId', '==', uid)
      .orderBy('date', 'desc')
      .limit(50)
      .onSnapshot(
        (snapshot: any) => {
          const posts = snapshot.docs.map((d: any) => ({ id: d.id, ...d.data() }));
          console.log('[PROFILE] Loaded user posts:', posts.length);
          setUserPosts(posts);
          setLoadingPosts(false);
          // Update posts stat in real-time
          setStats((prev) => ({ ...prev, posts: posts.length }));
        },
        (error: any) => {
          console.warn('[PROFILE][WARN] posts subscription failed', error?.message);
          setLoadingPosts(false);
        }
      );
    return () => {
      console.log('[PROFILE] Cleaning up posts subscription');
      unsubscribe();
    };
  }, [uid, firebaseEnabled]);

  const computedDisplayName =
    profile?.displayName ||
    profile?.username ||
    (user as any)?.displayName ||
    (user as any)?.email?.split('@')[0] ||
    'User';

  const computedHandle =
    profile?.handle ||
    profile?.username ||
    `user_${(user as any)?.uid?.slice(0, 6) || 'anon'}`;

  const displayName = useMemo(() => {
    const dn = profile?.displayName?.trim?.();
    if (dn) return dn;
    const authName = (user as any)?.displayName?.trim?.();
    if (authName) return authName;
    const email = (user as any)?.email?.trim?.();
    if (email) return email.split('@')[0];
    return 'User';
  }, [profile, user]);

  const handleLabel = useMemo(() => {
    const h = profile?.handle?.trim?.();
    if (h) return h.startsWith('@') ? h : `@${h}`;
    const username = profile?.username?.trim?.();
    if (username) return `@${username}`;
    if (uid) return `@${(uid as string).slice(0, 8)}`;
    return '@user';
  }, [profile, uid]);

  const avatarSource = useMemo(() => {
    const url = profile?.photoURL || profile?.avatarUrl || null;
    if (url && typeof url === 'string' && url.startsWith('http')) return { uri: url };
    return null;
  }, [profile]);

  const bioText = useMemo(() => {
    const b = profile?.bio?.trim?.();
    return b && b.length > 0 ? b : 'Add a bio';
  }, [profile]);

  const onEditProfile = useCallback(() => {
    if (!uid) return; // B1 gate
    try { nav.navigate('EditProfile' as never); } catch {}
    try { console.log('📈 profile_edit_tap', { userId: uid, source: 'profile_self' }); } catch {}
  }, [nav, uid]);

  const onWallet = useCallback(() => {
    if (!uid) return; // B1 gate
    try { nav.navigate('CoinStore' as never); } catch { try { nav.navigate('WalletStub' as never); } catch {} }
    try { console.log('📈 profile_wallet_tap', { userId: uid, source: 'profile_self' }); } catch {}
  }, [nav, uid]);

  const onSettings = useCallback(() => {
    if (!uid) return; // B1 gate
    try { nav.navigate('SettingsStub' as never); } catch {}
    try { console.log('📈 profile_settings_tap', { userId: uid, source: 'profile_self' }); } catch {}
  }, [nav, uid]);

  const onGoLive = useCallback(async () => {
    if (!uid) return; // B1 gate
    try { const ok = await isLiveStreamingEnabledAsync(); if (ok) { nav.navigate('LiveStream' as never); } else { nav.navigate('LiveUnavailableStub' as never); } } catch { nav.navigate('LiveUnavailableStub' as never); }
    try { console.log('📈 profile_go_live_tap', { userId: uid, source: 'profile_self' }); } catch {}
  }, [nav, uid]);

  const onMyVideos = useCallback(() => {
    if (!uid) return; // B1 gate
    try { nav.navigate('MyVideosStub' as never); } catch {}
  }, [nav, uid]);

  const onPastLives = useCallback(() => {
    if (!uid) return; // B1 gate
    try { nav.navigate('PastLivesStub' as never); } catch {}
  }, [nav, uid]);

  const onLogout = useCallback(async () => {
    if (!uid) return; // gate
    try { console.log('📈 profile_logout_tap', { userId: uid, source: 'profile_self' }); } catch {}
    // C1: Proper sign-out and cleanup
    try {
      const authObj: any = (firebaseCfg as any)?.auth;
      if (authObj && typeof authObj.signOut === 'function') {
        await authObj.signOut();
      }
    } catch (e: any) {
      try { console.warn('[PROFILE][WARN] signOut failed', e?.message); } catch {}
    }
    // Clear local profile-related state
    setProfile(null);
    setStats({ followers: 0, following: 0, likes: 0, posts: 0, lives: 0 });
    setErr(null);
    setBusy(false);
    // Navigate to Auth/onboarding
    try { nav.navigate('Auth' as never); } catch {}
  }, [nav, uid]);

  const handlePostPress = useCallback((post: any) => {
    try {
      console.log('[PROFILE] Opening post:', post.id);
      (nav as any).navigate('MediaViewer', { post });
    } catch (e) {
      console.warn('[PROFILE][WARN] Failed to navigate to MediaViewer', e);
    }
  }, [nav]);

  const renderPostItem = useCallback(({ item: post }: { item: any }) => {
    // For videos, use thumbnail field; for images use imageUrl
    const thumbUri = post.type === 'video' 
      ? (post.thumbnail || post.thumbnailUrl || post.videoUrl)
      : (post.imageUrl || post.media?.[0]?.url);
    
    return (
    <TouchableOpacity
      style={styles.postCard}
      onPress={() => handlePostPress(post)}
      activeOpacity={0.8}
    >
      {thumbUri ? (
        <Image source={{ uri: thumbUri }} style={styles.postThumb} resizeMode="cover" />
      ) : (
        <View style={[styles.postThumb, styles.postThumbPlaceholder]}>
          <Icon name={"image" as any} size={24} color="#64748b" style={{}} strokeWidth={undefined} />
        </View>
      )}
      <View style={styles.postOverlay}>
        {post.type === 'video' && (
          <Icon name={"play-circle" as any} size={20} color="#fff" style={{}} strokeWidth={undefined} />
        )}
      </View>
      <View style={styles.postMeta}>
        <View style={styles.postMetric}>
          <Icon name={"heart" as any} size={12} color="#ec4899" style={{}} strokeWidth={undefined} />
          <Text style={styles.postMetricText}>{post.likes || post.likeCount || 0}</Text>
        </View>
        <View style={styles.postMetric}>
          <Icon name={"chatbubble" as any} size={12} color="#8b5cf6" style={{}} strokeWidth={undefined} />
          <Text style={styles.postMetricText}>{post.comments?.length || post.commentCount || 0}</Text>
        </View>
      </View>
    </TouchableOpacity>
    );
  }, [handlePostPress]);

  // Unified loading state: auth not ready OR profile not loaded
  const isLoading = !authReady || authLoading || busy;
  const hasUser = !!uid;

  // OLD CODE - DISABLED
  if (false && !uid) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" />
        <HeaderContainer onLayout={(e: any)=>setHeaderHeight(e.nativeEvent.layout.height)}>
          <View style={{ alignItems: 'center', paddingVertical: 12 }}>
            <BlypLogo style={{}} useGradientBackground={false} textStyle={{ fontSize: 24 }} />
          </View>
        </HeaderContainer>
        <View style={[styles.centerArea, { paddingTop: headerHeight }]}> 
          <Text style={styles.stateText}>You are logged out.</Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={()=>nav.navigate('Auth' as never)}>
            <Text style={styles.primaryBtnText}>Login / Sign up</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (false && busy) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" />
        <HeaderContainer onLayout={(e: any)=>setHeaderHeight(e.nativeEvent.layout.height)}>
          <View style={{ alignItems: 'center', paddingVertical: 12 }}>
            <BlypLogo style={{}} useGradientBackground={false} textStyle={{ fontSize: 24 }} />
          </View>
        </HeaderContainer>
        <View style={[styles.centerArea, { paddingTop: headerHeight }]}> 
          <ActivityIndicator color="#ec4899" size="large" />
          <Text style={styles.stateSub}>Loading your profile…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (false && err) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" />
        <HeaderContainer onLayout={(e: any)=>setHeaderHeight(e.nativeEvent.layout.height)}>
          <View style={{ alignItems: 'center', paddingVertical: 12 }}>
            <BlypLogo style={{}} useGradientBackground={false} textStyle={{ fontSize: 24 }} />
          </View>
        </HeaderContainer>
        <View style={[styles.centerArea, { paddingTop: headerHeight }]}> 
          <Text style={styles.stateText}>Couldn’t load profile</Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={onRetry}>
            <Text style={styles.primaryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      <HeaderContainer onLayout={(e: any)=>setHeaderHeight(e.nativeEvent.layout.height)}>
        <View style={styles.headerTop}>
          <TouchableOpacity
            onPress={() => (nav as any).openDrawer()}
            style={styles.menuButton}
          >
            <Icon name="menu" size={24} color="#d1d5db" style={{}} strokeWidth={1.5} />
          </TouchableOpacity>

          <View style={styles.logoContainer}>
            <BlypLogo style={{}} textStyle={{}} useGradientBackground={true} />
          </View>

          <TouchableOpacity
            onPress={() => nav.navigate('Search' as never)}
            style={styles.searchButton}
          >
            <Icon name="search" size={24} color="#d1d5db" style={{}} strokeWidth={1.5} />
          </TouchableOpacity>
        </View>

        <View style={styles.tabContainer}>
          <View style={styles.tabSelector}>
            {['My Profile', '1', '2', '3'].map(tab => (
              <TouchableOpacity
                key={tab}
                style={styles.tab}
                onPress={() => setActiveTab(tab)}
              >
                <Text
                  style={[
                    styles.tabText,
                    activeTab === tab && styles.activeTabText,
                  ]}
                >
                  {tab}
                </Text>
              </TouchableOpacity>
            ))}

            {/* Tab Indicator */}
            <View style={[
              styles.tabIndicator,
              {
                left: activeTab === 'My Profile' ? '2%' :
                      activeTab === '1' ? '27%' :
                      activeTab === '2' ? '52%' : '77%'
              }
            ]}>
              <LinearGradient
                colors={['#a855f7', '#d946ef', '#ec4899']}
                style={styles.tabIndicatorGradient}
              />
            </View>
          </View>
        </View>
      </HeaderContainer>

      {!hasUser ? (
        // Logged out state
        <View style={styles.centerArea}> 
          <Text style={styles.stateText}>You are logged out.</Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={()=>nav.navigate('Auth' as never)}>
            <Text style={styles.primaryBtnText}>Login / Sign up</Text>
          </TouchableOpacity>
        </View>
      ) : err ? (
        // Error state
        <View style={styles.centerArea}> 
          <Text style={styles.stateText}>Couldn't load profile</Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={onRetry}>
            <Text style={styles.primaryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView 
        style={styles.scrollView} 
        contentContainerStyle={[styles.scrollContent, { paddingTop: 8 }]} 
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#ec4899"/>}
        showsVerticalScrollIndicator={false}
      >
        {isLoading ? (
          // Loading skeleton - shown while auth/data loading
          <View style={styles.centerArea}>
            <ActivityIndicator color="#ec4899" size="large" />
            <Text style={styles.stateSub}>Loading your profile…</Text>
          </View>
        ) : (
          // Profile content
          <>
          {/* Tab Content: My Profile */}
          {profileTab === 'myProfile' && (
          <>
        {/* Profile Header Section */}
        <View style={styles.profileHeader}>
          {/* Avatar */}
          <View style={styles.avatarContainer}>
            {avatarSource ? (
              <Image source={avatarSource} style={styles.avatar} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarInitial}>
                  {(displayName || 'U').slice(0,1).toUpperCase()}
                </Text>
              </View>
            )}
          </View>

          {/* Name and Handle Section */}
          <View style={styles.profileInfo}>
            <View style={styles.nameSection}>
              <Text style={styles.displayName} numberOfLines={1}>
                {computedDisplayName}
              </Text>
              {handleLabel ? (
                <Text style={styles.handle} numberOfLines={1}>
                  @{computedHandle}
                </Text>
              ) : (
                <TouchableOpacity onPress={onEditProfile} activeOpacity={0.7}>
                  <Text style={styles.handleAdd}>@username</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>

        {/* Bio Section */}
        {profile?.bio && profile.bio.trim().length > 0 ? (
          <View style={styles.bioContainer}>
            <Text style={styles.bioText} numberOfLines={3}>
              {profile.bio}
            </Text>
          </View>
        ) : (
          <TouchableOpacity onPress={onEditProfile} style={styles.bioContainer} activeOpacity={0.7}>
            <Text style={styles.bioPlaceholder}>Tap to add bio</Text>
          </TouchableOpacity>
        )}

        {/* Stats Row - TikTok Style */}
        <View style={styles.statsContainer}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{renderStat(stats.posts)}</Text>
            <Text style={styles.statLabel}>Posts</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{renderStat(stats.followers)}</Text>
            <Text style={styles.statLabel}>Followers</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{renderStat(stats.following)}</Text>
            <Text style={styles.statLabel}>Following</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{renderStat(stats.likes)}</Text>
            <Text style={styles.statLabel}>Likes</Text>
          </View>
        </View>

        {/* Action Buttons Row */}
        <View style={styles.actionsContainer}>
          <TouchableOpacity style={styles.primaryActionBtn} onPress={onEditProfile} activeOpacity={0.8}>
            <Icon name={"create" as any} size={16} color="#fff" style={{}} strokeWidth={undefined}/>
            <Text style={styles.actionBtnText}>Edit Profile</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryActionBtn} onPress={onWallet} activeOpacity={0.8}>
            <Icon name={"wallet" as any} size={16} color="#cbd5e1" style={{}} strokeWidth={undefined}/>
            <Text style={styles.secondaryActionText}>Wallet</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryActionBtn} onPress={onSettings} activeOpacity={0.8}>
            <Icon name={"settings" as any} size={16} color="#cbd5e1" style={{}} strokeWidth={undefined}/>
            <Text style={styles.secondaryActionText}>Settings</Text>
          </TouchableOpacity>
        </View>

        {/* Divider */}
        <View style={styles.divider} />

        {/* My Posts Section */}
        <View style={styles.postsSection}>
          <View style={styles.postsSectionHeader}>
            <Text style={styles.postsSectionTitle}>My Posts</Text>
            <View style={styles.postsCountBadge}>
              <Text style={styles.postsCountText}>{userPosts.length}</Text>
            </View>
          </View>

          {loadingPosts ? (
            <View style={styles.postsEmptyState}>
              <ActivityIndicator color="#ec4899" size="large" />
              <Text style={styles.emptyStateText}>Loading posts...</Text>
            </View>
          ) : userPosts.length === 0 ? (
            <View style={styles.postsEmptyState}>
              <View style={styles.emptyIconCircle}>
                <Icon name={"camera" as any} size={40} color="#64748b" style={{}} strokeWidth={undefined} />
              </View>
              <Text style={styles.emptyStateTitle}>No posts yet</Text>
              <Text style={styles.emptyStateSubtitle}>Share your first moment with the world!</Text>
            </View>
          ) : (
            <FlatList
              data={userPosts}
              renderItem={renderPostItem}
              keyExtractor={(item) => item.id}
              numColumns={3}
              scrollEnabled={false}
              columnWrapperStyle={styles.postsRow}
              contentContainerStyle={styles.postsGrid}
            />
          )}
        </View>

        {/* Past Live Streams Section */}
        <View style={styles.liveSection}>
          <View style={styles.liveSectionHeader}>
            <Text style={styles.liveSectionTitle}>Past Live Streams</Text>
            <TouchableOpacity onPress={onPastLives} activeOpacity={0.7}>
              <Text style={styles.viewAllLink}>View all</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.liveEmptyState}>
            <Icon name={"radio" as any} size={28} color="#64748b" style={{}} strokeWidth={undefined} />
            <Text style={styles.liveEmptyText}>No live streams yet</Text>
          </View>
        </View>

        {/* Logout Button */}
        <View style={styles.logoutSection}>
          <TouchableOpacity style={styles.logoutBtn} onPress={onLogout} activeOpacity={0.8}>
            <Text style={styles.logoutBtnText}>Logout</Text>
          </TouchableOpacity>
        </View>
          </>
          )}
          </>
        )}
      </ScrollView>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  // Base container
  container: { 
    flex: 1, 
    backgroundColor: '#0f172a' 
  },
  
  // Header with tabs (unified Messenger style)
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 16,
  },

  menuButton: {
    padding: 8,
  },

  logoContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },

  searchButton: {
    padding: 8,
  },

  tabContainer: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },

  tabSelector: {
    position: 'relative',
    backgroundColor: '#374151',
    borderRadius: 9999,
    padding: 4,
    flexDirection: 'row',
  },

  tab: {
    flex: 1,
    paddingVertical: 6,
    alignItems: 'center',
    zIndex: 2,
  },

  tabText: {
    color: '#9ca3af',
    fontSize: 12,
    fontWeight: '600',
  },

  activeTabText: {
    color: '#ffffff',
  },

  tabIndicator: {
    position: 'absolute',
    top: 2,
    bottom: 2,
    width: '25%',
    borderRadius: 9999,
    zIndex: 1,
  },

  tabIndicatorGradient: {
    flex: 1,
    borderRadius: 9999,
  },

  headerIcon: { 
    padding: 8,
    borderRadius: 20,
  },
  
  // ScrollView
  scrollView: { 
    flex: 1 
  },
  scrollContent: { 
    paddingBottom: 40 
  },
  
  // Loading/Error states
  centerArea: { 
    flex: 1, 
    alignItems: 'center', 
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  stateText: { 
    color: '#e5e7eb', 
    fontSize: 18, 
    fontWeight: '600',
    marginTop: 12,
    textAlign: 'center',
  },
  stateSub: { 
    color: '#94a3b8', 
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
  },
  
  // Profile Header Section
  profileHeader: { 
    flexDirection: 'row', 
    paddingHorizontal: 20,
    paddingTop: 20,
    alignItems: 'center',
  },
  avatarContainer: { 
    marginRight: 16 
  },
  avatar: { 
    width: 90, 
    height: 90, 
    borderRadius: 45,
    borderWidth: 3,
    borderColor: '#1e293b',
  },
  avatarPlaceholder: { 
    width: 90, 
    height: 90, 
    borderRadius: 45,
    backgroundColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#1e293b',
  },
  avatarInitial: { 
    color: '#fff', 
    fontSize: 32, 
    fontWeight: '700' 
  },
  profileInfo: { 
    flex: 1,
    justifyContent: 'center',
  },
  nameSection: { 
    gap: 4 
  },
  displayName: { 
    color: '#ffffff', 
    fontSize: 22, 
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  handle: { 
    color: '#94a3b8', 
    fontSize: 15,
    fontWeight: '500',
  },
  handleAdd: { 
    color: '#60a5fa', 
    fontSize: 15,
    fontWeight: '600',
  },
  
  // Bio Section
  bioContainer: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  bioText: { 
    color: '#cbd5e1', 
    fontSize: 14,
    lineHeight: 20,
  },
  bioPlaceholder: { 
    color: '#64748b', 
    fontSize: 14,
    fontStyle: 'italic',
  },
  
  // Stats Row (TikTok-style)
  statsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 20,
    marginTop: 4,
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  statItem: { 
    alignItems: 'center',
    flex: 1,
  },
  statValue: { 
    color: '#ffffff', 
    fontSize: 20, 
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  statLabel: { 
    color: '#94a3b8', 
    fontSize: 12,
    marginTop: 4,
    fontWeight: '500',
  },
  statDivider: {
    width: 1,
    height: 28,
    backgroundColor: '#1e293b',
  },
  
  // Action Buttons
  actionsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 8,
  },
  primaryActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ec4899',
    paddingVertical: 12,
    borderRadius: 10,
    gap: 6,
  },
  actionBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  secondaryActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1e293b',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
    gap: 6,
    borderWidth: 1,
    borderColor: '#334155',
  },
  secondaryActionText: {
    color: '#cbd5e1',
    fontSize: 14,
    fontWeight: '600',
  },
  
  // Divider
  divider: {
    height: 8,
    backgroundColor: '#1e293b',
    marginTop: 24,
  },
  
  // Posts Section
  postsSection: {
    paddingTop: 20,
  },
  postsSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 16,
    gap: 8,
  },
  postsSectionTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  postsCountBadge: {
    backgroundColor: '#1e293b',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  postsCountText: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '600',
  },
  postsEmptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: 32,
  },
  emptyIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#1e293b',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    borderWidth: 2,
    borderColor: '#334155',
  },
  emptyStateTitle: {
    color: '#e5e7eb',
    fontSize: 17,
    fontWeight: '600',
    marginTop: 4,
    marginBottom: 6,
  },
  emptyStateText: {
    color: '#94a3b8',
    fontSize: 15,
    marginTop: 12,
  },
  emptyStateSubtitle: {
    color: '#64748b',
    fontSize: 14,
    textAlign: 'center',
  },
  postsGrid: {
    paddingHorizontal: 20,
  },
  postsRow: {
    gap: 4,
    marginBottom: 4,
  },
  
  // Post Card
  postCard: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: '#1e293b',
    position: 'relative',
  },
  postThumb: {
    width: '100%',
    height: '100%',
  },
  postThumbPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0f172a',
  },
  postOverlay: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 12,
    padding: 2,
  },
  postMeta: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    gap: 8,
    padding: 6,
    backgroundColor: 'rgba(0,0,0,0.75)',
  },
  postMetric: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  postMetricText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '600',
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  
  // Live Streams Section
  liveSection: {
    paddingHorizontal: 20,
    marginTop: 32,
  },
  liveSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  liveSectionTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  viewAllLink: {
    color: '#60a5fa',
    fontSize: 14,
    fontWeight: '600',
  },
  liveEmptyState: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  liveEmptyText: {
    color: '#94a3b8',
    fontSize: 14,
    marginTop: 8,
  },
  
  // Logout Section
  logoutSection: {
    paddingHorizontal: 20,
    marginTop: 32,
  },
  logoutBtn: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: '#ef4444',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  logoutBtnText: {
    color: '#ef4444',
    fontSize: 15,
    fontWeight: '700',
  },
  
  // Legacy - kept for state screens
  primaryBtn: { 
    backgroundColor: '#ec4899', 
    borderRadius: 10, 
    paddingHorizontal: 24, 
    paddingVertical: 14,
    minWidth: 140,
    alignItems: 'center',
  },
  primaryBtnText: { 
    color: '#fff', 
    fontSize: 16,
    fontWeight: '700' 
  },
});

export default ProfileScreenV3;
