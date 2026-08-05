/*
  FEATURE: Current user Profile – v3
  SOURCE OF TRUTH: Spec + checklist from BLYP-01 (see implementation command)
  NOTES:
    - Current user only (own profile)
    - Must render under fixed Blyp header
    - Must satisfy P0 acceptance checklist
*/
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, SafeAreaView, ScrollView, TouchableOpacity, Image, ActivityIndicator, RefreshControl, StatusBar, FlatList, Alert, Modal, Platform, useWindowDimensions, BackHandler } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import HeaderContainer, { HEADER_ICON_COLOR } from '../components/HeaderContainer';
import ScreenContainer from '../components/ScreenContainer';
import BlypHeaderFlow from '../components/BlypHeaderFlow';
import BlypLogo, { BLYP_LOGO_GRADIENT_COLORS } from '../components/BlypLogo';
import Icon from '../components/Icon';
import StandingBadge from '../components/StandingBadge';
import HeaderMenuTabs from '../components/HeaderMenuTabs';
import PlanStatusBanner from '../components/PlanStatusBanner';
import { useEntitlement } from '../hooks/useEntitlement';
import HeaderWalletBalances from '../components/HeaderWalletBalances';
import { getEconomyWallet } from '../api/economyLiveApi';
import { shouldUseLiveServiceWallet } from '../utils/walletSource';
import BlypCoinService from '../services/BlypCoinService';
import GemService from '../services/GemService';
import { useAuth, refreshAuthNow, hardLogout } from '../hooks/useCommon';
import { useTabReset } from '../utils/tabResetBus';
import { exitGuestMode, useGuestMode } from '../services/guestSessionService';
import { useTheme } from '../styles/useTheme';
import type { BlypTheme } from '../styles/blypTheme';
import { db, firebaseEnabled } from '../config/firebase';
import * as firebaseCfg from '../config/firebase';
import { primeStreamingFlag, isLiveStreamingEnabledAsync } from '../config/StreamingFeatureFlag';
import CoinStoreScreen from './CoinStoreScreen';
import PromoteTab from '../components/PromoteTab';
import { mediaViewerParams } from '../utils/mediaViewerPlaylist';
import ProfileCategoryChips from '../components/ProfileCategoryChips';
import ManageProfileCategoriesSheet from '../components/ManageProfileCategoriesSheet';
import ProfileIdentityFlair from '../components/ProfileIdentityFlair';
import {
  buildProfileCategoryChips,
  filterPostsByCategory,
  normalizeProfileCategories,
} from '../utils/profileCategories';
import { updatePostCategory } from '../services/postEditService';
import { sharePosts } from '../services/shareService';
import {
  normalizeProfileBadges,
  normalizeProfileClubs,
} from '../services/profileIdentityCatalog';

type ProfileCategory = { id: string; label: string; order: number };
type ProfileCategoryChip = { id: string; label: string; count: number };

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

// Count documents matching a compat Firestore query without transferring them.
// Uses server-side aggregation when available and falls back to a bounded read.
const countQuery = async (query: any): Promise<number> => {
  try {
    if (typeof query?.count === 'function') {
      const snap = await query.count().get();
      const data = typeof snap?.data === 'function' ? snap.data() : snap?.data;
      const c = data?.count;
      if (Number.isFinite(Number(c))) return Number(c);
    }
  } catch {
    // aggregate unsupported on this backend — fall through to a bounded read
  }
  const snap = await query.limit(2000).get();
  return snap?.docs?.length ?? 0;
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

// One page of posts at a time; older pages load as the user scrolls so every
// post on the account is reachable (no 50-post ceiling).
const PROFILE_PAGE_SIZE = 30;
// We load a user's whole post set in one capped window (sorted client-side) so
// posts missing a `date` field still appear. 1000 comfortably covers real users.
const PROFILE_POSTS_CAP = 1000;

const toMillis = (value: any): number => {
  try {
    if (!value) return 0;
    if (typeof value?.toMillis === 'function') return value.toMillis();
    if (typeof value === 'number') return value;
    if (typeof value?.seconds === 'number') return value.seconds * 1000;
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? d.getTime() : 0;
  } catch {
    return 0;
  }
};

const sortPostsNewestFirst = (posts: any[]) => {
  posts.sort((a, b) => {
    const aMs = toMillis(a?.date || a?.createdAt || a?.timestamp);
    const bMs = toMillis(b?.date || b?.createdAt || b?.timestamp);
    return bMs - aMs;
  });
  return posts;
};

// A Cognito `sub` is a UUID; legacy writes sometimes stored it as the display
// name. Detect that so we can fall back to the real handle instead of showing
// a raw id where a name belongs.
const looksLikeOpaqueId = (value: any): boolean => {
  const t = String(value || '').trim();
  if (!t) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t);
};

/** True when the user has deliberately set a public screen name (@handle). */
const hasChosenScreenName = (profile: any, uid?: string | null): boolean => {
  const raw = String(profile?.username || profile?.handle || '').trim();
  const noAt = raw.startsWith('@') ? raw.slice(1) : raw;
  const cleaned = noAt.trim();
  if (!cleaned) return false;
  if (looksLikeOpaqueId(cleaned)) return false;
  if (uid && cleaned === String(uid)) return false;
  if (/^user_/i.test(cleaned)) return false;
  return /^[A-Za-z0-9_.]{3,20}$/.test(cleaned);
};

type ProfileTabKey = 'myProfile' | 'tab1' | 'tab2' | 'tab3';

const mapHeaderTabToProfileTab = (tabLabel: string): ProfileTabKey => {
  if (tabLabel === 'My Profile') return 'myProfile';
  if (tabLabel === 'Promote' || tabLabel === 'Friends') return 'tab1';
  if (tabLabel === 'Wallet') return 'tab2';
  return 'tab3';
};

const ProfileScreenV3: React.FC = () => {
  const nav = useNavigation();
  const { user, uid, authReady, loading: authLoading } = useAuth();
  const [profileTab, setProfileTab] = useState<ProfileTabKey>('myProfile');
  const [activeTab, setActiveTab] = useState('My Profile');
  const isGuest = useGuestMode();
  // Double-tap the Profile tab → reset to the first sub-page ("My Profile").
  useTabReset('Profile', () => setActiveTab('My Profile'));
  const [headerHeight, setHeaderHeight] = useState(0);
  const [profile, setProfile] = useState<any>(null);
  const [stats, setStats] = useState<{ followers: StatValue; following: StatValue; likes: StatValue; posts: StatValue; lives: StatValue }>({ followers: 0, following: 0, likes: 0, posts: 0, lives: 0 });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [coinBalance, setCoinBalance] = useState(0);
  const [gemBalance, setGemBalance] = useState(0);
  const [userPosts, setUserPosts] = useState<any[]>([]);
  const [loadingPosts, setLoadingPosts] = useState(true);
  const [loadingMorePosts, setLoadingMorePosts] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all');
  const [manageCategoriesVisible, setManageCategoriesVisible] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Record<string, true>>({});
  const [bulkBusy, setBulkBusy] = useState(false);
  const extracting = useRef(false);
  const lastBackfillSig = useRef<string>('');
  const profileHydratedRef = useRef(false);

  // Posts pagination: a shared id->post map plus a cursor/hasMore per source
  // (own uid + optional legacy username alias). The live first page seeds the
  // cursor once; loadMorePosts pages older posts in on scroll.
  const postsMapRef = useRef<Map<string, any>>(new Map());
  const uidPageRef = useRef<{ cursor: any; hasMore: boolean; init: boolean }>({ cursor: null, hasMore: true, init: false });
  const legacyPageRef = useRef<{ cursor: any; hasMore: boolean; init: boolean }>({ cursor: null, hasMore: true, init: false });
  const loadingMoreRef = useRef(false);

  const flushPosts = useCallback(() => {
    const merged = Array.from(postsMapRef.current.values());
    sortPostsNewestFirst(merged);
    setUserPosts(merged);
  }, []);

  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { width, height } = useWindowDimensions();
  const tabBarHeight = useBottomTabBarHeight();
  const isCompact = width < 390;
  const isShort = height < 750;

  const loadBalances = useCallback(async () => {
    if (!uid || !authReady) {
      setCoinBalance(0);
      setGemBalance(0);
      return;
    }
    try {
      if (shouldUseLiveServiceWallet()) {
        try {
          const wallet = await getEconomyWallet();
          const coins = Number(wallet?.coinBalance || 0) + Number(wallet?.bonusCoinBalance || 0);
          const gems = Number(wallet?.gemAvailable || 0) + Number(wallet?.gemPending || 0);
          setCoinBalance(Number.isFinite(coins) ? coins : 0);
          setGemBalance(Number.isFinite(gems) ? gems : 0);
          return;
        } catch (e: any) {
          console.warn('[PROFILE_V3][BALANCES] live-service wallet fetch failed; falling back', e?.message || String(e));
        }
      }

      const coins = await BlypCoinService.getUserBalance(uid);
      const gems = await GemService.getUserGems(uid);
      setCoinBalance(Number.isFinite(coins) ? coins : 0);
      setGemBalance(Number.isFinite(gems) ? gems : 0);
    } catch (e: any) {
      console.warn('[PROFILE_V3][BALANCES] failed', e?.message || String(e));
      setCoinBalance(0);
      setGemBalance(0);
    }
  }, [uid, authReady]);

  useEffect(() => {
    if (!menuVisible) return;
    loadBalances();
  }, [menuVisible, loadBalances]);

  // Legacy identity support:
  // Older data (posts/users) may be keyed by Cognito username (e.g. "blyp") instead of Cognito sub.
  // When present, we treat it as an alias so the user's existing posts show on their own profile.
  const legacyUserId = useMemo(() => {
    try {
      const raw =
        (profile?.username as any) ||
        (profile?.handle as any) ||
        (user as any)?.username ||
        (typeof (user as any)?.getUsername === 'function' ? (user as any).getUsername() : null) ||
        '';
      const s = String(raw || '').trim();
      if (!s) return null;
      const noAt = s.startsWith('@') ? s.slice(1) : s;
      const normalized = noAt.trim();
      if (!normalized) return null;
      const lower = normalized.toLowerCase();
      if (!uid) return lower;
      if (lower === String(uid).toLowerCase()) return null;
      return lower;
    } catch {
      return null;
    }
  }, [profile?.username, profile?.handle, user, uid]);

  // Ensure streaming flag primed once
  useEffect(() => { try { primeStreamingFlag(); } catch { } }, []);

  // Preserve header tab UI behavior and map selection to internal profileTab state.
  useEffect(() => {
    setProfileTab(mapHeaderTabToProfileTab(activeTab));
  }, [activeTab]);

  // Ensure wallet tab shows fresh balances.
  useEffect(() => {
    if (profileTab !== 'tab2' && profileTab !== 'tab1') return;
    loadBalances();
  }, [profileTab, loadBalances]);

  // Auth gating: redirect if unauthenticated
  useEffect(() => {
    // No-op: there is no 'Auth' route. When not signed in, the app root renders
    // AuthScreen directly, and guests intentionally keep browsing. The logged-out
    // and guest UI below provide the explicit sign-in CTA.
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
      } catch { }

      // If the uid-based doc is empty/missing fields, try legacy username-based doc (users/{legacyUserId}).
      // This addresses accounts created before the switch to Cognito sub as uid.
      try {
        if (legacyUserId) {
          const legacySnap = await db.collection('users').doc(legacyUserId).get();
          const legacyData: any = legacySnap?.data?.() ?? legacySnap?.data?.();
          if (legacyData) {
            // Merge legacy onto basics, preferring explicit values already present on basics.
            basics = { ...(legacyData || {}), ...(basics || {}) };
          }
        }
      } catch { }
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

      // Self-heal: an older bug persisted the raw uid/UUID as displayName/username.
      // If we can derive a real name (handle/username/email), repair the doc
      // so the source of truth is fixed for everyone reading it.
      try {
        const storedDn = String(basics?.displayName || '').trim();
        const storedUn = String(basics?.username || basics?.handle || '').trim();
        const badName = (v: string) =>
          !!v && (looksLikeOpaqueId(v) || v === String(uid) || /^user_/i.test(v));
        const emailLocal = String((user as any)?.email || basics?.email || '').split('@')[0]?.trim() || '';
        const repaired = [basics?.handle, basics?.username, emailLocal]
          .map((v: any) => String(v || '').trim())
          .find((v: string) => v && !badName(v));

        const patch: Record<string, any> = {};
        if (badName(storedDn) && repaired) {
          basics = { ...basics, displayName: repaired };
          patch.displayName = repaired;
        }
        if (badName(storedUn)) {
          // Clear opaque Cognito usernames that were wrongly saved as Blyp handles.
          if (repaired && !badName(repaired)) {
            basics = { ...basics, username: repaired, handle: repaired };
            patch.username = repaired;
            patch.handle = repaired;
          } else {
            basics = { ...basics, username: null, handle: null };
            patch.username = null;
            patch.handle = null;
            if (!patch.displayName && repaired) {
              basics = { ...basics, displayName: repaired };
              patch.displayName = repaired;
            }
          }
        }
        if (Object.keys(patch).length) {
          try {
            await db.collection('users').doc(uid).set(patch, { merge: true });
          } catch { /* non-fatal */ }
        }
      } catch { }

      setProfile(basics);
      profileHydratedRef.current = true;

      // Followers count (each query failure isolated per A2)
      let followers: StatValue = 0;
      let following: StatValue = 0;
      let likes: StatValue = 0;
      let posts: StatValue = 0;
      let lives: StatValue = 0;
      try {
        followers = safeNumber(await countQuery(db.collection('followers').where('userId', '==', uid)));
      } catch (e: any) {
        try { console.warn('[PROFILE][WARN] followers load failed', e?.message); } catch { }
        followers = null;
      }
      try {
        following = safeNumber(await countQuery(db.collection('followers').where('followerId', '==', uid)));
      } catch (e: any) {
        try { console.warn('[PROFILE][WARN] following load failed', e?.message); } catch { }
        following = null;
      }
      try {
        // Count posts/likes for uid and legacy alias (if any)
        const docsById = new Map<string, any>();
        // Bounded read: these docs are needed to sum likes, so we can't use an
        // aggregate. 500 covers essentially every real account while capping the
        // worst case.
        const snap1 = await db.collection('posts').where('userId', '==', uid).limit(500).get();
        (snap1?.docs || []).forEach((d: any) => { try { docsById.set(d.id, d); } catch { } });
        if (legacyUserId) {
          const snap2 = await db.collection('posts').where('userId', '==', legacyUserId).limit(500).get();
          (snap2?.docs || []).forEach((d: any) => { try { docsById.set(d.id, d); } catch { } });
        }
        const allDocs = Array.from(docsById.values());
        // True total via server-side aggregate (a post has exactly one userId,
        // so uid + legacy never double-count). Falls back to the bounded read.
        try {
          let total = await countQuery(db.collection('posts').where('userId', '==', uid));
          if (legacyUserId) {
            total += await countQuery(db.collection('posts').where('userId', '==', legacyUserId));
          }
          posts = safeNumber(total > 0 ? total : allDocs.length);
        } catch {
          posts = safeNumber(allDocs.length);
        }
        likes = safeNumber(allDocs.reduce((acc: number, d: any) => {
          const data = typeof d.data === 'function' ? d.data() : d.data;
          const v = safeNumber(data?.likes);
          return acc + v;
        }, 0));
      } catch (e: any) {
        try { console.warn('[PROFILE][WARN] posts/likes load failed', e?.message); } catch { }
        posts = null; likes = null;
      }
      try {
        const ls = await db.collection('liveStreams').where('userId', '==', uid).get();
        lives = safeNumber(ls?.docs?.length ?? 0);
      } catch (e: any) {
        try { console.warn('[PROFILE][WARN] lives load failed', e?.message); } catch { }
        lives = null;
      }
      setStats({ followers, following, likes, posts, lives });

      setBusy(false);
      setErr(null);
      // Analytics: profile_view_self
      if (uid) { try { console.log('📈 profile_view_self', { userId: uid, source: 'profile_self', at: new Date().toISOString() }); } catch { } }
    } catch (e: any) {
      setBusy(false);
      setErr('Could not load your profile.');
    } finally {
      extracting.current = false;
    }
  }, [uid, legacyUserId]);

  useEffect(() => { if (uid) void loadAll(); }, [uid, loadAll]);

  // Refresh profile when returning to this tab (e.g. after EditProfile save).
  useFocusEffect(
    useCallback(() => {
      if (!uid || isGuest) return undefined;
      void loadAll();
      return undefined;
    }, [uid, isGuest, loadAll]),
  );

  // Best-effort: keep older posts' denormalized author fields in sync so feed shows latest name/photo.
  useEffect(() => {
    if (!uid || !firebaseEnabled) return;
    // Never backfill a raw uid / UUID into posts' author fields.
    const dnRaw = String(profile?.displayName || '').trim();
    const unRaw = String(profile?.username || '').trim();
    const safeDn = dnRaw && !looksLikeOpaqueId(dnRaw) && dnRaw !== String(uid) ? dnRaw : '';
    const safeUn = unRaw && !looksLikeOpaqueId(unRaw) && unRaw !== String(uid) ? unRaw : '';
    const display = (safeDn || safeUn).trim();
    const photo = String(profile?.photoURL || '').trim();
    if (!display && !photo) return;

    const sig = `${display}|${photo}`;
    if (lastBackfillSig.current === sig) return;
    lastBackfillSig.current = sig;

    const patch: Record<string, any> = {};
    if (display) {
      patch.username = display;
      patch.userDisplayName = display;
      patch['user.username'] = display;
      patch['user.displayName'] = display;
    }
    if (photo) {
      patch.userPhotoURL = photo;
      patch['user.avatar'] = photo;
    }

    const backfill = async (ownerId: string) => {
      try {
        const snap = await db.collection('posts').where('userId', '==', ownerId).limit(200).get();
        const docs = snap?.docs || [];
        for (const d of docs) {
          try {
            await db.collection('posts').doc(d.id).set(patch, { merge: true });
          } catch { }
        }
      } catch { }
    };

    void backfill(uid);
    if (legacyUserId) {
      void backfill(legacyUserId);
    }
  }, [uid, legacyUserId, firebaseEnabled, profile?.displayName, profile?.username, profile?.photoURL]);

  // Subscribe to user posts (realtime first page) + paginate older pages.
  useEffect(() => {
    if (!uid || !firebaseEnabled) {
      setUserPosts([]);
      setLoadingPosts(false);
      return;
    }
    console.log('[PROFILE] Setting up posts subscription for user:', { uid, legacyUserId });
    setLoadingPosts(true);

    // Reset pagination state for this (possibly new) user.
    postsMapRef.current = new Map();
    uidPageRef.current = { cursor: null, hasMore: true, init: false };
    legacyPageRef.current = { cursor: null, hasMore: true, init: false };

    const applySnapshot = (snapshot: any) => {
      try {
        const changes = typeof snapshot?.docChanges === 'function' ? snapshot.docChanges() : null;
        if (Array.isArray(changes) && changes.length) {
          changes.forEach((c: any) => {
            try {
              const d = c?.doc;
              const id = d?.id;
              if (!id) return;
              if (c?.type === 'removed') {
                postsMapRef.current.delete(id);
                return;
              }
              postsMapRef.current.set(id, { id, ...(typeof d?.data === 'function' ? d.data() : {}) });
            } catch { }
          });
        } else {
          snapshot?.docs?.forEach?.((d: any) => {
            try { postsMapRef.current.set(d.id, { id: d.id, ...d.data() }); } catch { }
          });
        }
      } catch { }
      flushPosts();
      setLoadingPosts(false);
    };

    const subscribeOne = (userIdToSub: string, pageRef: { cursor: any; hasMore: boolean; init: boolean }) => {
      let unsub: any = null;
      // IMPORTANT: query by userId WITHOUT orderBy('date'). Firestore silently
      // omits documents that lack the orderBy field, so any post missing a `date`
      // (older/imported/seeded docs) would never appear — which is why a profile
      // could show ~30 of 200+ posts. We load the full set (capped) and sort
      // client-side by date|createdAt|timestamp, so EVERY post shows.
      const onNext = (snapshot: any) => {
        pageRef.hasMore = false; // everything is loaded in one window; no cursor paging
        pageRef.init = true;
        applySnapshot(snapshot);
      };
      const onError = (error: any) => {
        console.warn('[PROFILE][WARN] posts subscription failed', error?.message);
        setLoadingPosts(false);
      };

      unsub = db
        .collection('posts')
        .where('userId', '==', userIdToSub)
        .limit(PROFILE_POSTS_CAP)
        .onSnapshot(onNext, onError);

      return () => {
        try { unsub?.(); } catch { }
      };
    };

    const unsubs: Array<() => void> = [];
    unsubs.push(subscribeOne(uid, uidPageRef.current));
    if (legacyUserId) {
      unsubs.push(subscribeOne(legacyUserId, legacyPageRef.current));
    }

    return () => {
      console.log('[PROFILE] Cleaning up posts subscription');
      unsubs.forEach((u) => {
        try { u(); } catch { }
      });
    };
  }, [uid, legacyUserId, firebaseEnabled, flushPosts]);

  // Load the next older page of posts (across own uid + legacy alias) and append.
  const loadMorePosts = useCallback(async () => {
    if (loadingMoreRef.current || !firebaseEnabled) return;
    const sources: Array<{ id: string; ref: { cursor: any; hasMore: boolean; init: boolean } }> = [];
    if (uid && uidPageRef.current.hasMore && uidPageRef.current.cursor) {
      sources.push({ id: uid as string, ref: uidPageRef.current });
    }
    if (legacyUserId && legacyPageRef.current.hasMore && legacyPageRef.current.cursor) {
      sources.push({ id: legacyUserId, ref: legacyPageRef.current });
    }
    if (sources.length === 0) return;

    loadingMoreRef.current = true;
    setLoadingMorePosts(true);
    try {
      for (const s of sources) {
        try {
          const snap = await db
            .collection('posts')
            .where('userId', '==', s.id)
            .orderBy('date', 'desc')
            .startAfter(s.ref.cursor)
            .limit(PROFILE_PAGE_SIZE)
            .get();
          const docs = snap?.docs || [];
          if (docs.length) s.ref.cursor = docs[docs.length - 1];
          s.ref.hasMore = docs.length >= PROFILE_PAGE_SIZE;
          docs.forEach((d: any) => {
            try { postsMapRef.current.set(d.id, { id: d.id, ...d.data() }); } catch { }
          });
        } catch (e: any) {
          console.warn('[PROFILE][WARN] loadMorePosts page failed', e?.message || String(e));
          s.ref.hasMore = false;
        }
      }
      flushPosts();
    } finally {
      loadingMoreRef.current = false;
      setLoadingMorePosts(false);
    }
  }, [uid, legacyUserId, firebaseEnabled, flushPosts]);

  // Never surface a raw uid / UUID as the name. Prefer a real display name,
  // then the handle, then the auth name, then the email local-part.
  const nameCandidate = (v: any): string => {
    const s = typeof v === 'string' ? v.trim() : '';
    if (!s) return '';
    if (looksLikeOpaqueId(s)) return '';
    if (uid && s === String(uid)) return '';
    return s;
  };
  const computedDisplayName =
    nameCandidate(profile?.displayName) ||
    nameCandidate(profile?.username) ||
    nameCandidate((user as any)?.displayName) ||
    nameCandidate((user as any)?.email?.split('@')[0]) ||
    'User';

  const computedHandle = (() => {
    const h = nameCandidate(profile?.handle) || nameCandidate(profile?.username);
    return h || '';
  })();

  const displayName = useMemo(() => {
    const dn = profile?.displayName?.trim?.();
    if (dn && !looksLikeOpaqueId(dn) && dn !== String(uid || '')) return dn;
    const un = profile?.username?.trim?.();
    if (un && !looksLikeOpaqueId(un) && un !== String(uid || '')) return un;
    const hn = profile?.handle?.trim?.();
    if (hn && !looksLikeOpaqueId(hn) && hn !== String(uid || '')) return hn;
    const authName = (user as any)?.displayName?.trim?.();
    if (authName && !looksLikeOpaqueId(authName)) return authName;
    const email = (user as any)?.email?.trim?.();
    if (email) return email.split('@')[0];
    return 'User';
  }, [profile, user, uid]);

  // Never show a truncated Cognito uid as @handle — that made Profile look broken
  // after signup even when a real display name existed (or should have).
  const handleLabel = useMemo(() => {
    if (!hasChosenScreenName(profile, uid)) return '';
    const raw = String(profile?.handle || profile?.username || '').trim();
    const noAt = raw.startsWith('@') ? raw.slice(1) : raw;
    return noAt ? `@${noAt}` : '';
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
    try { nav.navigate('EditProfile' as never); } catch { }
    try { console.log('📈 profile_edit_tap', { userId: uid, source: 'profile_self' }); } catch { }
  }, [nav, uid]);

  const onWallet = useCallback(() => {
    if (!uid) return; // B1 gate
    try { nav.navigate('CoinStore' as never); } catch { try { nav.navigate('WalletStub' as never); } catch { } }
    try { console.log('📈 profile_wallet_tap', { userId: uid, source: 'profile_self' }); } catch { }
  }, [nav, uid]);

  const onSettings = useCallback(() => {
    if (!uid) return; // B1 gate
    try { nav.navigate('SettingsStub' as never); } catch { }
    try { console.log('📈 profile_settings_tap', { userId: uid, source: 'profile_self' }); } catch { }
  }, [nav, uid]);

  const onTransparency = useCallback(() => {
    if (!uid) return; // B1 gate
    try { nav.navigate('Transparency' as never); } catch { }
    try { console.log('📈 profile_transparency_tap', { userId: uid, source: 'profile_self' }); } catch { }
  }, [nav, uid]);

  const onPlans = useCallback(() => {
    if (!uid) return; // B1 gate
    try { nav.navigate('Plans' as never); } catch { }
    try { console.log('📈 profile_plans_tap', { userId: uid, source: 'profile_self' }); } catch { }
  }, [nav, uid]);

  const onImport = useCallback(() => {
    if (!uid) return; // B1 gate
    try { nav.navigate('ImportContent' as never); } catch { }
    try { console.log('📈 profile_import_tap', { userId: uid, source: 'profile_self' }); } catch { }
  }, [nav, uid]);

  const onHub = useCallback(() => {
    if (!uid) return; // B1 gate
    try { nav.navigate('Hub' as never); } catch { }
    try { console.log('📈 profile_hub_tap', { userId: uid, source: 'profile_self' }); } catch { }
  }, [nav, uid]);

  // There is no 'Auth' route — AuthScreen renders at the app root when not
  // signed in. Dropping guest mode + hard sign-out flips the root gate to it.
  const goToAuth = useCallback(async () => {
    try { await exitGuestMode(); } catch { }
    try { await hardLogout(); } catch { }
  }, []);

  const onGoLive = useCallback(async () => {
    if (!uid) return; // B1 gate
    try {
      const ok = await isLiveStreamingEnabledAsync();
      if (ok) {
        (nav as any).navigate('LiveStreamScreen', { mode: 'host', source: 'profile' });
      } else {
        nav.navigate('LiveUnavailableStub' as never);
      }
    } catch {
      nav.navigate('LiveUnavailableStub' as never);
    }
    try { console.log('📈 profile_go_live_tap', { userId: uid, source: 'profile_self' }); } catch { }
  }, [nav, uid]);

  const onPastLives = useCallback(() => {
    if (!uid) return; // B1 gate
    try { console.log('📈 profile_past_lives_tap', { userId: uid, source: 'profile_self' }); } catch { }
    // Route to the registered Past Lives screen (stub until full history ships).
    try { (nav as any).navigate('PastLivesStub' as never); } catch { }
  }, [nav, uid]);

  const onLogout = useCallback(async () => {
    if (!uid) return; // B1 gate
    try { console.log('📈 profile_logout_tap', { userId: uid, source: 'profile_self' }); } catch { }

    try {
      // Primary auth is Cognito in this app.
      const maybeCognitoUser: any = user;
      if (maybeCognitoUser?.signOut) {
        await new Promise<void>((resolve) => {
          try {
            // Some Cognito SDKs accept a callback.
            const out = maybeCognitoUser.signOut(() => resolve());
            // If signOut is sync/no callback, resolve on next tick.
            if (out === undefined) setTimeout(resolve, 0);
          } catch {
            resolve();
          }
        });
      }
    } catch (e: any) {
      try { console.warn('[PROFILE][WARN] signOut failed', e?.message || String(e)); } catch { }
    }

    try {
      // Best-effort: also sign out Firebase if present.
      const fbAuth: any = (firebaseCfg as any)?.auth;
      if (fbAuth?.signOut) {
        await fbAuth.signOut();
      }
    } catch { }

    // Hard sign-out: latch forceLoggedOut + clear every in-memory auth window so
    // the App-level gate drops to AuthScreen immediately (not after the 120s
    // optimistic window). Also drop any guest session for good measure.
    try { await hardLogout(); } catch { }
    try { await exitGuestMode(); } catch { }
    try { refreshAuthNow?.(null as any); } catch { }

    // Clear local profile-related state
    try { setMenuVisible(false); } catch { }
    setProfile(null);
    setStats({ followers: 0, following: 0, likes: 0, posts: 0, lives: 0 });
    setErr(null);
    setBusy(false);

    // Reset to root so App-level auth gate can render AuthScreen immediately.
    try { (nav as any).reset?.({ index: 0, routes: [{ name: 'MainTabs' }] }); return; } catch { }
    try { (nav as any).navigate?.('MainTabs' as never); } catch { }
  }, [nav, uid, user]);

  const onAvatarPress = useCallback(() => {
    Alert.alert('Profile photo', 'Choose an option', [
      { text: 'View photo', onPress: () => { } },
      { text: 'Change photo', onPress: () => onEditProfile() },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [onEditProfile]);

  const profileCategories = useMemo(
    (): ProfileCategory[] =>
      normalizeProfileCategories(profile?.profileCategories) as ProfileCategory[],
    [profile?.profileCategories],
  );

  const categoryChips = useMemo(
    (): ProfileCategoryChip[] =>
      buildProfileCategoryChips(profileCategories, userPosts) as ProfileCategoryChip[],
    [profileCategories, userPosts],
  );

  const filteredPosts = useMemo(
    () => filterPostsByCategory(userPosts, selectedCategoryId),
    [userPosts, selectedCategoryId],
  );

  const handlePostPress = useCallback((post: any) => {
    try {
      console.log('[PROFILE] Opening post:', post.id);
      const ownerIds = [uid, legacyUserId].filter(Boolean);
      (nav as any).navigate(
        'MediaViewer',
        mediaViewerParams(post, filteredPosts, { ownerIds, source: 'profile' }),
      );
    } catch (e) {
      console.warn('[PROFILE][WARN] Failed to navigate to MediaViewer', e);
    }
  }, [nav, uid, legacyUserId, filteredPosts]);

  const canDeletePost = useCallback((post: any) => {
    const owner = String(post?.userId || '').trim();
    if (!owner) return false;
    if (uid && owner === uid) return true;
    if (legacyUserId && owner === legacyUserId) return true;
    return false;
  }, [uid, legacyUserId]);

  const selectedCount = useMemo(() => Object.keys(selectedIds).length, [selectedIds]);
  const selectedPosts = useMemo(
    () => userPosts.filter((p) => p?.id && selectedIds[p.id]),
    [userPosts, selectedIds],
  );

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIds({});
    setBulkBusy(false);
  }, []);

  const enterSelectMode = useCallback((postId?: string) => {
    setSelectMode(true);
    if (postId) setSelectedIds({ [postId]: true });
  }, []);

  const togglePostSelected = useCallback((postId: string) => {
    if (!postId) return;
    setSelectedIds((prev) => {
      const next = { ...prev };
      if (next[postId]) delete next[postId];
      else next[postId] = true;
      return next;
    });
  }, []);

  // Android back exits multi-select instead of leaving the tab.
  useEffect(() => {
    if (!selectMode) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      exitSelectMode();
      return true;
    });
    return () => sub.remove();
  }, [selectMode, exitSelectMode]);

  // Leaving My Profile clears selection so Promote/Wallet don't keep a stale bar.
  useEffect(() => {
    if (profileTab !== 'myProfile' && selectMode) exitSelectMode();
  }, [profileTab, selectMode, exitSelectMode]);

  const handleBulkDelete = useCallback(() => {
    if (!uid || !firebaseEnabled || bulkBusy) return;
    const ids = Object.keys(selectedIds);
    if (ids.length === 0) return;
    const deletable = selectedPosts.filter(canDeletePost);
    if (deletable.length === 0) {
      Alert.alert('Nothing to delete', 'None of the selected posts can be deleted.');
      return;
    }
    const n = deletable.length;
    Alert.alert(
      'Delete posts',
      `Delete ${n} selected post${n === 1 ? '' : 's'} permanently? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setBulkBusy(true);
            let failed = 0;
            const deletedIds: string[] = [];
            for (const post of deletable) {
              try {
                await db.collection('posts').doc(post.id).delete();
                deletedIds.push(post.id);
              } catch {
                failed += 1;
              }
            }
            if (deletedIds.length > 0) {
              const gone = new Set(deletedIds);
              setUserPosts((prev) => prev.filter((p) => !gone.has(p.id)));
              setStats((prev) => ({
                ...prev,
                posts: Math.max(0, safeNumber(prev.posts) - deletedIds.length),
              }));
            }
            setBulkBusy(false);
            exitSelectMode();
            if (failed > 0) {
              Alert.alert(
                'Partial delete',
                `Deleted ${deletedIds.length} post${deletedIds.length === 1 ? '' : 's'}; ${failed} failed.`,
              );
            }
          },
        },
      ],
    );
  }, [uid, firebaseEnabled, bulkBusy, selectedIds, selectedPosts, canDeletePost, exitSelectMode]);

  const handleBulkMoveToCategory = useCallback(() => {
    if (bulkBusy) return;
    const ids = Object.keys(selectedIds);
    if (ids.length === 0) return;
    if (!profileCategories.length) {
      Alert.alert(
        'No categories yet',
        'Tap Manage under your post shelves to create categories first.',
      );
      return;
    }
    Alert.alert(
      'Move to category',
      `Assign ${ids.length} selected post${ids.length === 1 ? '' : 's'} to a shelf`,
      [
        ...profileCategories.map((c) => ({
          text: c.label,
          onPress: async () => {
            setBulkBusy(true);
            let failed = 0;
            for (const id of ids) {
              const res = await updatePostCategory(id, c.id);
              if (!res?.ok) failed += 1;
              else {
                setUserPosts((prev) =>
                  prev.map((p) => (p.id === id ? { ...p, categoryId: c.id } : p)),
                );
              }
            }
            setBulkBusy(false);
            exitSelectMode();
            if (failed > 0) {
              Alert.alert('Partial update', `${ids.length - failed} moved; ${failed} failed.`);
            }
          },
        })),
        {
          text: 'Clear category',
          style: 'destructive' as const,
          onPress: async () => {
            setBulkBusy(true);
            let failed = 0;
            for (const id of ids) {
              const res = await updatePostCategory(id, null);
              if (!res?.ok) failed += 1;
              else {
                setUserPosts((prev) =>
                  prev.map((p) => (p.id === id ? { ...p, categoryId: null } : p)),
                );
              }
            }
            setBulkBusy(false);
            exitSelectMode();
            if (failed > 0) {
              Alert.alert('Partial update', `${ids.length - failed} cleared; ${failed} failed.`);
            }
          },
        },
        { text: 'Cancel', style: 'cancel' as const },
      ],
    );
  }, [bulkBusy, selectedIds, profileCategories, exitSelectMode]);

  const handleBulkShare = useCallback(async () => {
    if (bulkBusy || selectedPosts.length === 0) return;
    setBulkBusy(true);
    try {
      await sharePosts(selectedPosts);
    } finally {
      setBulkBusy(false);
    }
  }, [bulkBusy, selectedPosts]);

  const onPostCardPress = useCallback((post: any) => {
    if (selectMode) {
      togglePostSelected(post.id);
      return;
    }
    handlePostPress(post);
  }, [selectMode, togglePostSelected, handlePostPress]);

  const onPostCardLongPress = useCallback((post: any) => {
    if (!canDeletePost(post)) return;
    if (selectMode) {
      togglePostSelected(post.id);
      return;
    }
    enterSelectMode(post.id);
  }, [canDeletePost, selectMode, togglePostSelected, enterSelectMode]);

  const renderPostItem = useCallback(({ item: post }: { item: any }) => {
    // TikTok-style cover: always show a still image (the video's poster frame),
    // never an mp4 in <Image>. Prefer the dedicated thumbnail fields; for image
    // posts use the image itself. Falls back to a placeholder if truly absent.
    const pickStr = (...vals: any[]) =>
      vals.map((v) => (typeof v === 'string' ? v.trim() : '')).find((v) => v.length > 0) || '';
    const thumbUri = post.type === 'video'
      ? pickStr(post.thumbnail, post.thumbnailUrl, post.media?.[0]?.thumbnail, post.posterUrl)
      : pickStr(post.imageUrl, post.thumbnail, post.media?.[0]?.url, post.mediaUrl);

    const title = String(post?.title || post?.captionTitle || '').trim();
    const isSelected = !!(post?.id && selectedIds[post.id]);

    return (
      <TouchableOpacity
        style={[styles.postCard, selectMode && isSelected && styles.postCardSelected]}
        onPress={() => onPostCardPress(post)}
        onLongPress={() => onPostCardLongPress(post)}
        delayLongPress={400}
        activeOpacity={0.8}
      >
        {thumbUri ? (
          <Image source={{ uri: thumbUri }} style={styles.postThumb} resizeMode="cover" />
        ) : (
          <View style={[styles.postThumb, styles.postThumbPlaceholder]}>
            <Icon name={"image" as any} size={24} color={theme.colors.textMuted} style={{}} strokeWidth={undefined} />
          </View>
        )}
        {selectMode ? (
          <View style={[styles.selectCheck, isSelected && styles.selectCheckOn]}>
            {isSelected ? (
              <Icon name={"checkmark" as any} size={14} color="#fff" style={{}} strokeWidth={undefined} />
            ) : null}
          </View>
        ) : (
          <View style={styles.postOverlay}>
            <View pointerEvents="none" style={styles.postOverlayBg} />
            {post.type === 'video' && (
              <Icon name={"play-circle" as any} size={20} color={theme.colors.textPrimary} style={{}} strokeWidth={undefined} />
            )}
          </View>
        )}
        <View style={styles.postMeta}>
          <View pointerEvents="none" style={styles.postMetaBg} />
          {!!title && (
            <Text style={styles.postTitleText} numberOfLines={1}>
              {title}
            </Text>
          )}
          <View style={styles.postMetricsRow}>
            <View style={styles.postMetric}>
              <Icon name={"heart" as any} size={12} color={theme.colors.accent} style={{}} strokeWidth={undefined} />
              <Text style={styles.postMetricText}>{post.likes || post.likeCount || 0}</Text>
            </View>
            <View style={styles.postMetric}>
              <Icon name={"chatbubble" as any} size={12} color={theme.colors.primary} style={{}} strokeWidth={undefined} />
              <Text style={styles.postMetricText}>{post.comments?.length || post.commentCount || 0}</Text>
            </View>
          </View>
        </View>
      </TouchableOpacity>
    );
  }, [onPostCardPress, onPostCardLongPress, selectedIds, selectMode, styles, theme]);

  // For the virtualized posts grid: pad the last row to a multiple of 3 with
  // invisible placeholders so 3-up cells never stretch on a short final row.
  const gridData = useMemo(() => {
    const rem = filteredPosts.length % 3;
    if (rem === 0) return filteredPosts;
    const pad = Array.from({ length: 3 - rem }).map((_, i) => ({ id: `__ph_${i}`, __placeholder: true }));
    return [...filteredPosts, ...pad];
  }, [filteredPosts]);

  const renderProfileGridItem = useCallback(({ item }: { item: any }) => {
    if (item?.__placeholder) return <View style={styles.postCellWrap} />;
    return <View style={styles.postCellWrap}>{renderPostItem({ item })}</View>;
  }, [renderPostItem, styles]);

  // Loading gate: don't block the main Profile tab while fetching profile data.
  // Keep Wallet/Promote tabs gated if they depend on loaded balances.
  const isLoading = !authReady || authLoading || (profileTab !== 'myProfile' && busy);
  const authPending = !authReady || authLoading;
  const hasUser = !!uid;
  const showLoggedOut = !authPending && !hasUser;

  // Guest browsing has no profile. Invite them to create an account instead of
  // showing an empty/broken "my profile".
  if (isGuest && !hasUser) {
    return (
      <ScreenContainer>
        <StatusBar barStyle="light-content" />
        <View style={[styles.centerArea, { paddingHorizontal: 28 }]}>
          <BlypLogo style={{}} useGradientBackground={false} textStyle={{ fontSize: 28 }} />
          <Text style={[styles.stateText, { marginTop: 18, textAlign: 'center' }]}>You're browsing as a guest</Text>
          <Text style={[styles.stateSub, { textAlign: 'center', marginTop: 8 }]}>
            Create a free account to set up your profile, post, follow people and earn coins.
          </Text>
          <TouchableOpacity
            style={[styles.primaryBtn, { marginTop: 24 }]}
            onPress={() => { exitGuestMode().catch(() => { }); }}
          >
            <LinearGradient colors={BLYP_LOGO_GRADIENT_COLORS} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.primaryBtnGradient}>
              <Text style={styles.primaryBtnText}>Sign up or log in</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </ScreenContainer>
    );
  }

  // OLD CODE - DISABLED
  if (false && !uid) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" />
        <HeaderContainer onLayout={(e: any) => setHeaderHeight(e.nativeEvent.layout.height)}>
          <View style={{ alignItems: 'center', paddingVertical: 12 }}>
            <BlypLogo style={{}} useGradientBackground={false} textStyle={{ fontSize: 24 }} />
          </View>
        </HeaderContainer>
        <View style={[styles.centerArea, { paddingTop: headerHeight }]}>
          <Text style={styles.stateText}>You are logged out.</Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => nav.navigate('Auth' as never)}>
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
        <HeaderContainer onLayout={(e: any) => setHeaderHeight(e.nativeEvent.layout.height)}>
          <View style={{ alignItems: 'center', paddingVertical: 12 }}>
            <BlypLogo style={{}} useGradientBackground={false} textStyle={{ fontSize: 24 }} />
          </View>
        </HeaderContainer>
        <View style={[styles.centerArea, { paddingTop: headerHeight }]}>
          <ActivityIndicator color={theme.colors.accent} size="large" />
          <Text style={styles.stateSub}>Loading your profile…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (false && err) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" />
        <HeaderContainer onLayout={(e: any) => setHeaderHeight(e.nativeEvent.layout.height)}>
          <View style={{ alignItems: 'center', paddingVertical: 12 }}>
            <BlypLogo style={{}} useGradientBackground={false} textStyle={{ fontSize: 24 }} />
          </View>
        </HeaderContainer>
        <View style={[styles.centerArea, { paddingTop: headerHeight }]}>
          <Text style={styles.stateText}>Couldn’t load profile</Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={onRetry}>
            <LinearGradient colors={BLYP_LOGO_GRADIENT_COLORS} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.primaryBtnGradient}>
              <Text style={styles.primaryBtnText}>Retry</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <ScreenContainer noSafeArea>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
      <BlypHeaderFlow
        tabs={[
          { key: 'My Profile', label: 'My Profile' },
          { key: 'Promote', label: 'Promote' },
          { key: 'Wallet', label: 'Wallet' },
          { key: 'Menu', label: 'Menu' },
        ]}
        matchHomePadding={true}
        activeKey={activeTab}
        onTabChange={setActiveTab}
        onMenuPress={() => setMenuVisible(true)}
        onSearchPress={() => nav.navigate('Search' as never)}
        onLayout={(e: any) => setHeaderHeight(e.nativeEvent.layout.height)}
      />

      <View style={styles.contentShell}>
        {(activeTab === 'My Profile' || activeTab === 'Promote' || activeTab === 'Wallet' || activeTab === 'Menu') && (
          <LinearGradient
            pointerEvents="none"
            colors={['rgba(255,255,255,0.03)', 'transparent', 'transparent']}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={styles.sectionGradientBackground}
          />
        )}

        {!showLoggedOut && <PlanStatusBanner />}

        {showLoggedOut ? (
          // Logged out state
          <View style={styles.centerArea}>
            <Text style={styles.stateText}>You are logged out.</Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={goToAuth}>
              <LinearGradient colors={BLYP_LOGO_GRADIENT_COLORS} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.primaryBtnGradient}>
                <Text style={styles.primaryBtnText}>Login / Sign up</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        ) : authPending ? (
          <View style={styles.centerArea}>
            <ActivityIndicator color={theme.colors.accent} size="large" />
            <Text style={styles.stateSub}>Loading…</Text>
          </View>
        ) : err ? (
          // Error state
          <View style={styles.centerArea}>
            <Text style={styles.stateText}>Couldn't load profile</Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={onRetry}>
              <LinearGradient colors={BLYP_LOGO_GRADIENT_COLORS} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.primaryBtnGradient}>
                <Text style={styles.primaryBtnText}>Retry</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        ) : profileTab === 'tab2' ? (
          <View style={{ flex: 1, paddingBottom: tabBarHeight }}>
            {isLoading ? (
              <View style={styles.centerArea}>
                <ActivityIndicator color={theme.colors.accent} size="large" />
                <Text style={styles.stateSub}>Loading your wallet…</Text>
              </View>
            ) : (
              <CoinStoreScreen navigation={nav as any} embedded />
            )}
          </View>
        ) : profileTab === 'tab1' ? (
          <View style={{ flex: 1, paddingBottom: tabBarHeight }}>
            {isLoading ? (
              <View style={styles.centerArea}>
                <ActivityIndicator color={theme.colors.accent} size="large" />
                <Text style={styles.stateSub}>Loading…</Text>
              </View>
            ) : (
              <PromoteTab
                currentCoins={coinBalance}
                onCoinsChanged={(next: number) => setCoinBalance(Number.isFinite(Number(next)) ? Number(next) : 0)}
                navigation={nav as any}
              />
            )}
          </View>
        ) : profileTab === 'myProfile' ? (
          // Virtualized profile feed: the posts grid IS the scroller (numColumns
          // 3), with the profile card/stats as the header. This only mounts the
          // visible rows, so large profiles scroll smoothly instead of mounting
          // hundreds of thumbnails up-front.
          <>
          <FlatList
            style={styles.scrollView}
            data={gridData}
            renderItem={renderProfileGridItem}
            keyExtractor={(item: any) => item.id}
            numColumns={3}
            columnWrapperStyle={styles.profileGridRow}
            contentContainerStyle={[
              styles.scrollContent,
              {
                paddingTop: 8,
                paddingBottom: tabBarHeight + theme.spacing.xl + (selectMode ? 72 : 0),
              },
            ]}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.accent} />}
            showsVerticalScrollIndicator={false}
            onEndReached={() => { void loadMorePosts(); }}
            onEndReachedThreshold={1.5}
            initialNumToRender={15}
            maxToRenderPerBatch={12}
            windowSize={7}
            removeClippedSubviews
            ListHeaderComponent={(
              <>
                {/* ── Premium Profile Card ── */}
                <View style={styles.profileCard}>
                  <ProfileIdentity
                    avatarSource={avatarSource}
                    displayName={computedDisplayName}
                    handleLabel={handleLabel}
                    computedHandle={computedHandle}
                    fallbackInitial={(displayName || 'U').slice(0, 1).toUpperCase()}
                    badgeProfile={profile}
                    onAvatarPress={onAvatarPress}
                    onEditProfile={onEditProfile}
                    styles={styles}
                  />

                  <ProfileBioLinks
                    bio={profile?.bio}
                    onEditProfile={onEditProfile}
                    styles={styles}
                  />

                  <ProfileIdentityFlair
                    clubIds={normalizeProfileClubs(profile?.profileClubs)}
                    badgeIds={normalizeProfileBadges(profile?.profileBadges)}
                    style={styles.identityFlair}
                  />

                  <ProfileStats stats={stats} styles={styles} />

                  <ProfileActions
                    onEditProfile={onEditProfile}
                    onWallet={() => setActiveTab('Wallet')}
                    onSettings={() => setActiveTab('Menu')}
                    isCompact={isShort}
                    styles={styles}
                  />
                </View>

                <View style={styles.divider} />

                <ProfileCategoryChips
                  chips={categoryChips as any}
                  selectedId={selectedCategoryId}
                  onSelect={setSelectedCategoryId}
                  showManage
                  onManage={() => setManageCategoriesVisible(true)}
                />

                <View style={styles.postsSectionHeader}>
                  <Text style={styles.postsSectionTitle}>
                    {selectMode ? `${selectedCount} selected` : 'My Posts'}
                  </Text>
                  {selectMode ? (
                    <TouchableOpacity
                      onPress={exitSelectMode}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      style={styles.selectDoneBtn}
                    >
                      <Text style={styles.selectDoneText}>Done</Text>
                    </TouchableOpacity>
                  ) : (
                    <View style={styles.postsCountBadge}>
                      <Text style={styles.postsCountText}>
                        {filteredPosts.length}
                      </Text>
                    </View>
                  )}
                </View>
                {!selectMode && filteredPosts.length > 0 ? (
                  <Text style={styles.selectHint}>Long-press a post to select</Text>
                ) : null}
              </>
            )}
            ListEmptyComponent={(
              loadingPosts ? (
                <View style={[styles.postsEmptyState, { paddingVertical: 60 }]}>
                  <ActivityIndicator color={theme.colors.accent} size="large" />
                  <Text style={[styles.emptyStateText, { marginTop: 12 }]}>Loading posts...</Text>
                </View>
              ) : (
                <View style={[styles.postsEmptyState, { paddingVertical: 60 }]}>
                  <View style={[styles.emptyIconCircle, { width: 80, height: 80, borderRadius: 40 }]}>
                    <Icon name={"camera" as any} size={40} color={theme.colors.textMuted} style={{}} strokeWidth={undefined} />
                  </View>
                  <Text style={styles.emptyStateTitle}>
                    {selectedCategoryId === 'all' ? 'No posts yet' : 'Nothing in this category'}
                  </Text>
                  <Text style={styles.emptyStateSubtitle}>
                    {selectedCategoryId === 'all'
                      ? 'Share your first moment with the world!'
                      : 'Assign posts to this shelf when you create or edit them'}
                  </Text>
                </View>
              )
            )}
            ListFooterComponent={(
              <>
                {loadingMorePosts ? (
                  <View style={{ paddingVertical: 16, alignItems: 'center' }}>
                    <ActivityIndicator color={theme.colors.accent} size="small" />
                  </View>
                ) : null}
                <ProfileSocialProof
                  uid={uid}
                  onPastLives={onPastLives}
                  styles={styles}
                  theme={theme}
                />
                <ProfileLogout onLogout={onLogout} styles={styles} />
              </>
            )}
          />
          <ManageProfileCategoriesSheet
            visible={manageCategoriesVisible}
            onClose={() => setManageCategoriesVisible(false)}
            userId={uid}
            initialCategories={profileCategories as any}
            onSaved={(next: ProfileCategory[]) => {
              setProfile((prev: any) => ({ ...(prev || {}), profileCategories: next }));
            }}
          />
          {selectMode ? (
            <View style={[styles.bulkBar, { bottom: tabBarHeight }]}>
              <TouchableOpacity
                style={styles.bulkAction}
                onPress={handleBulkMoveToCategory}
                disabled={bulkBusy || selectedCount === 0}
                accessibilityLabel="Move selected to category"
              >
                <Icon name={"pricetag" as any} size={20} color={theme.colors.textPrimary} style={{}} strokeWidth={undefined} />
                <Text style={styles.bulkActionText}>Category</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.bulkAction}
                onPress={handleBulkShare}
                disabled={bulkBusy || selectedCount === 0}
                accessibilityLabel="Share selected"
              >
                <Icon name={"share-outline" as any} size={20} color={theme.colors.textPrimary} style={{}} strokeWidth={undefined} />
                <Text style={styles.bulkActionText}>Share</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.bulkAction}
                onPress={handleBulkDelete}
                disabled={bulkBusy || selectedCount === 0}
                accessibilityLabel="Delete selected"
              >
                <Icon name={"trash-outline" as any} size={20} color={theme.colors.accent} style={{}} strokeWidth={undefined} />
                <Text style={[styles.bulkActionText, { color: theme.colors.accent }]}>Delete</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.bulkAction}
                onPress={exitSelectMode}
                disabled={bulkBusy}
                accessibilityLabel="Cancel selection"
              >
                <Icon name={"close" as any} size={20} color={theme.colors.textMuted} style={{}} strokeWidth={undefined} />
                <Text style={[styles.bulkActionText, { color: theme.colors.textMuted }]}>Cancel</Text>
              </TouchableOpacity>
              {bulkBusy ? (
                <View style={styles.bulkBusyOverlay}>
                  <ActivityIndicator color={theme.colors.accent} size="small" />
                </View>
              ) : null}
            </View>
          ) : null}
          </>
        ) : (
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={[styles.scrollContent, { paddingTop: 8, paddingBottom: tabBarHeight + theme.spacing.xl }]}
            showsVerticalScrollIndicator={false}
          >
            {profileTab === 'tab3' ? (
              <ProfileMenuTab
                onEditProfile={onEditProfile}
                onPlans={onPlans}
                onTransparency={onTransparency}
                onImport={onImport}
                onHub={onHub}
                onLogout={onLogout}
                styles={styles}
              />
            ) : (
              <ProfileTabPlaceholder activeTab={activeTab} styles={styles} />
            )}
          </ScrollView>
        )}

        <Modal
          visible={menuVisible}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setMenuVisible(false)}
        >
          <TouchableOpacity
            style={styles.menuOverlay}
            activeOpacity={1}
            onPress={() => setMenuVisible(false)}
          >
            <View style={styles.menuBackdrop} />
            <View style={styles.menuContainer}>
              <TouchableOpacity
                style={styles.menuCloseButton}
                onPress={() => setMenuVisible(false)}
              >
                <Icon name="close" size={24} color={theme.colors.textSecondary} style={{}} strokeWidth={1.5} />
              </TouchableOpacity>

              <Text style={styles.menuTitle}>Menu</Text>

              <TouchableOpacity
                style={styles.menuActionButton}
                onPress={() => {
                  setMenuVisible(false);
                  (nav as any).navigate('HowBlypWorks', { mode: 'review' });
                }}
              >
                <LinearGradient colors={BLYP_LOGO_GRADIENT_COLORS} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.menuActionButtonGradient}>
                  <Text style={styles.menuButtonText}>Help</Text>
                </LinearGradient>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.menuLogoutButton}
                onPress={() => {
                  setMenuVisible(false);
                  hardLogout();
                }}
              >
                <Text style={styles.menuLogoutText}>Log out</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>
      </View>
    </ScreenContainer>
  );
};

const createStyles = (theme: BlypTheme) => StyleSheet.create({
  // Base container
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  contentShell: {
    flex: 1,
    position: 'relative',
  },
  sectionGradientBackground: {
    ...StyleSheet.absoluteFillObject,
  },

  // Premium profile card wrapper
  profileCard: {
    backgroundColor: theme.colors.card,
    marginHorizontal: 12,
    marginTop: 12,
    borderRadius: 20,
    paddingBottom: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    shadowColor: theme.colors.shadow,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.22,
    shadowRadius: 16,
    elevation: 6,
    overflow: 'hidden',
  },

  // Header with tabs (unified Messenger style)
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 16,
  },

  headerBalances: {
    position: 'absolute',
    left: 56,
    height: '100%',
    justifyContent: 'center',
  },

  menuOverlay: {
    flex: 1,
    backgroundColor: theme.colors.transparent,
    justifyContent: 'flex-start',
    alignItems: 'flex-start',
    paddingTop: 70,
  },
  menuBackdrop: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: theme.colors.shadow,
    opacity: 0.6,
  },
  menuContainer: {
    backgroundColor: theme.colors.surface,
    width: 250,
    maxWidth: '90%',
    margin: 16,
    borderRadius: 16,
    padding: 20,
  },
  menuCloseButton: {
    alignSelf: 'flex-end',
    padding: 6,
  },
  menuTitle: {
    color: theme.colors.textPrimary,
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 14,
  },
  balanceItems: {
    gap: 12,
    marginBottom: 16,
  },
  menuBalanceItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: theme.colors.surfaceAlt,
  },
  balanceIcon: {
    fontSize: 18,
  },
  balanceLabel: {
    flex: 1,
    color: theme.colors.textMuted,
    fontSize: 14,
    fontWeight: '700',
  },
  balanceValue: {
    color: theme.colors.textPrimary,
    fontSize: 16,
    fontWeight: '900',
  },
  menuActionButton: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    overflow: 'hidden',
  },
  menuActionButtonGradient: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
  },
  menuButtonText: {
    color: theme.colors.onBrand,
    fontSize: 14,
    fontWeight: '900',
  },
  menuLogoutButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#FF5A5F',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginTop: 10,
    alignItems: 'center',
  },
  menuLogoutText: { color: '#FF5A5F', fontWeight: '700', fontSize: 14 },

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

  tabPage: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  tabPageTitle: {
    color: theme.colors.textPrimary,
    fontSize: 18,
    fontWeight: '900',
    marginBottom: 12,
    textAlign: 'center',
  },
  walletCard: {
    borderRadius: 16,
    padding: 16,
  },
  walletRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 6,
    gap: 10,
  },
  walletIcon: {
    fontSize: 20,
  },
  walletValue: {
    color: theme.colors.textPrimary,
    fontSize: 30,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  tabPrimaryBtn: {
    marginTop: 12,
    borderRadius: 12,
    overflow: 'hidden',
  },
  tabPrimaryBtnGradient: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
  },
  tabPrimaryBtnText: {
    color: theme.colors.textPrimary,
    fontSize: 14,
    fontWeight: '900',
  },

  tabMenuList: {
    gap: 10,
  },
  tabMenuItem: {
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tabMenuItemText: {
    color: theme.colors.textPrimary,
    fontSize: 15,
    fontWeight: '800',
  },
  tabMenuChevron: {
    color: theme.colors.textMuted,
    fontSize: 18,
    fontWeight: '900',
  },

  tabSelector: {
    position: 'relative',
    backgroundColor: theme.colors.surfaceAlt,
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
    color: theme.colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },

  activeTabText: {
    color: theme.colors.textPrimary,
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
    color: theme.colors.textSecondary,
    fontSize: 18,
    fontWeight: '600',
    marginTop: 12,
    textAlign: 'center',
  },
  stateSub: {
    color: theme.colors.textMuted,
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
  },

  // Profile Header Section
  profileHeader: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarContainer: {
    marginRight: 16,
    marginBottom: 0,
    marginLeft: 0,
  },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  avatarPlaceholder: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: theme.colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  avatarInitial: {
    color: theme.colors.textPrimary,
    fontSize: 32,
    fontWeight: '700'
  },
  profileInfo: {
    flex: undefined,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  nameSection: {
    gap: 4,
    alignItems: 'flex-start',
  },
  displayName: {
    color: theme.colors.textPrimary,
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.6,
    textAlign: 'left',
  },
  handle: {
    color: theme.colors.textMuted,
    fontSize: 15,
    fontWeight: '500',
    textAlign: 'left',
  },
  handleAdd: {
    color: theme.colors.primary,
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'left',
  },

  // Bio Section
  bioContainer: {
    paddingHorizontal: 20,
    paddingTop: 16,
    alignItems: 'center',
  },
  identityFlair: {
    paddingHorizontal: 20,
    paddingTop: 10,
    alignItems: 'center',
  },
  bioText: {
    color: theme.colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  bioPlaceholder: {
    color: theme.colors.textMuted,
    fontSize: 14,
    fontStyle: 'italic',
    textAlign: 'center',
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
    color: theme.colors.textPrimary,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.6,
  },
  statLabel: {
    color: theme.colors.textMuted,
    fontSize: 11,
    marginTop: 5,
    fontWeight: '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  statDivider: {
    width: 1,
    height: 24,
    backgroundColor: theme.colors.divider,
  },

  // Action Buttons
  actionsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 8,
  },
  primaryActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    minHeight: 50,
    overflow: 'hidden',
  },
  primaryActionBtnGradient: {
    width: '100%',
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    gap: 7,
    borderRadius: 14,
    backgroundColor: theme.colors.surfaceAlt,
  },
  actionBtnText: {
    color: theme.colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  secondaryActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 14,
    gap: 7,
    borderWidth: 1,
    borderColor: theme.colors.border,
    minHeight: 50,
  },
  secondaryActionText: {
    color: theme.colors.textSecondary,
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: -0.2,
  },

  // Divider
  divider: {
    height: 8,
    backgroundColor: theme.colors.surface,
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
    color: theme.colors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  postsCountBadge: {
    backgroundColor: theme.colors.surface,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  postsCountText: {
    color: theme.colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  selectDoneBtn: {
    marginLeft: 'auto' as any,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  selectDoneText: {
    color: theme.colors.primary,
    fontSize: 14,
    fontWeight: '700',
  },
  selectHint: {
    color: theme.colors.textMuted,
    fontSize: 12,
    paddingHorizontal: 20,
    marginTop: -8,
    marginBottom: 12,
  },
  postCardSelected: {
    borderWidth: 2,
    borderColor: theme.colors.primary,
  },
  selectCheck: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#fff',
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  selectCheckOn: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  bulkBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: 10,
    paddingHorizontal: 8,
    backgroundColor: theme.colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border,
    zIndex: 20,
  },
  bulkAction: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minWidth: 64,
    paddingVertical: 4,
  },
  bulkActionText: {
    color: theme.colors.textPrimary,
    fontSize: 11,
    fontWeight: '600',
  },
  bulkBusyOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
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
    backgroundColor: theme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    borderWidth: 2,
    borderColor: theme.colors.border,
  },
  emptyStateTitle: {
    color: theme.colors.textSecondary,
    fontSize: 17,
    fontWeight: '600',
    marginTop: 4,
    marginBottom: 6,
  },
  emptyStateText: {
    color: theme.colors.textMuted,
    fontSize: 15,
    marginTop: 12,
  },
  emptyStateSubtitle: {
    color: theme.colors.textMuted,
    fontSize: 14,
    textAlign: 'center',
  },
  postsGrid: {
    paddingHorizontal: 20,
  },
  postsRow: {
    flexDirection: 'row',
    gap: 4,
    marginBottom: 4,
  },
  profileGridRow: {
    gap: 4,
    marginBottom: 4,
    paddingHorizontal: 20,
  },
  postCellWrap: {
    flex: 1,
  },

  // Post Card
  postCard: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: theme.colors.surface,
    position: 'relative',
  },
  postThumb: {
    width: '100%',
    height: '100%',
  },
  postThumbPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.background,
  },
  postOverlay: {
    position: 'absolute',
    top: 6,
    right: 6,
    borderRadius: 12,
    padding: 2,
    overflow: 'hidden',
  },
  postOverlayBg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: theme.colors.shadow,
    opacity: 0.5,
  },
  postMeta: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'column',
    gap: 4,
    padding: 6,
    overflow: 'hidden',
  },
  postMetaBg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: theme.colors.shadow,
    opacity: 0.75,
  },
  postTitleText: {
    color: theme.colors.textPrimary,
    fontSize: 10,
    fontWeight: '700',
    textShadowColor: theme.colors.shadow,
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  postMetricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  postMetric: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  postMetricText: {
    color: theme.colors.textPrimary,
    fontSize: 10,
    fontWeight: '600',
    textShadowColor: theme.colors.shadow,
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
    color: theme.colors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
  },
  viewAllLink: {
    color: theme.colors.info,
    fontSize: 14,
    fontWeight: '600',
  },
  liveEmptyState: {
    backgroundColor: theme.colors.surface,
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  liveEmptyText: {
    color: theme.colors.textMuted,
    fontSize: 14,
    marginTop: 8,
  },

  // Logout Section
  logoutSection: {
    paddingHorizontal: 20,
    marginTop: 32,
  },
  logoutBtn: {
    backgroundColor: theme.colors.transparent,
    borderWidth: 1.5,
    borderColor: theme.colors.error,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  logoutBtnText: {
    color: theme.colors.error,
    fontSize: 15,
    fontWeight: '700',
  },

  // Legacy - kept for state screens
  primaryBtn: {
    borderRadius: 10,
    minWidth: 140,
    alignItems: 'center',
    overflow: 'hidden',
  },
  primaryBtnGradient: {
    width: '100%',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 10,
  },
  primaryBtnText: {
    color: theme.colors.onBrand,
    fontSize: 16,
    fontWeight: '800'
  },
});

const profileBadgeStyles = StyleSheet.create({
  overlay: { position: 'absolute', right: -2, bottom: -2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});

const ProfileIdentity: React.FC<{
  avatarSource: any;
  displayName: string;
  handleLabel: string;
  computedHandle: string;
  fallbackInitial: string;
  badgeProfile?: any;
  onAvatarPress: () => void;
  onEditProfile: () => void;
  styles: any;
}> = ({ avatarSource, displayName, handleLabel, computedHandle, fallbackInitial, badgeProfile, onAvatarPress, onEditProfile, styles }) => {
  return (
    <View style={styles.profileHeader}>
      <TouchableOpacity style={styles.avatarContainer} onPress={onAvatarPress} activeOpacity={0.8}>
        {avatarSource ? (
          <Image source={avatarSource} style={styles.avatar} />
        ) : (
          <View style={styles.avatarPlaceholder}>
            <Text style={styles.avatarInitial}>{fallbackInitial}</Text>
          </View>
        )}
        <View style={profileBadgeStyles.overlay} pointerEvents="none">
          <StandingBadge profile={badgeProfile} variant="dot" size={20} />
        </View>
      </TouchableOpacity>

      <View style={styles.profileInfo}>
        <View style={[styles.nameSection, profileBadgeStyles.nameRow]}>
          <Text style={styles.displayName} numberOfLines={1}>
            {displayName}
          </Text>
          <StandingBadge profile={badgeProfile} variant="chip" />
        </View>
        <View style={styles.nameSection}>
          {handleLabel ? (
            <Text style={styles.handle} numberOfLines={1}>
              {handleLabel.startsWith('@') ? handleLabel : `@${handleLabel}`}
            </Text>
          ) : (
            <TouchableOpacity onPress={onEditProfile} activeOpacity={0.7}>
              <Text style={styles.handleAdd}>Add username</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
};

const ProfileBioLinks: React.FC<{ bio?: string; onEditProfile: () => void; styles: any }> = ({ bio, onEditProfile, styles }) => {
  const hasBio = typeof bio === 'string' && bio.trim().length > 0;
  if (hasBio) {
    return (
      <View style={styles.bioContainer}>
        <Text style={styles.bioText} numberOfLines={3}>
          {bio}
        </Text>
      </View>
    );
  }
  return (
    <TouchableOpacity onPress={onEditProfile} style={styles.bioContainer} activeOpacity={0.7}>
      <Text style={styles.bioPlaceholder}>Tap to add bio</Text>
    </TouchableOpacity>
  );
};

const ProfileStats: React.FC<{ stats: { followers: StatValue; following: StatValue; likes: StatValue; posts: StatValue; lives: StatValue }; styles: any }> = ({ stats, styles }) => {
  return (
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
  );
};

const ProfileActions: React.FC<{
  onEditProfile: () => void;
  onWallet: () => void;
  onSettings: () => void;
  isCompact: boolean;
  styles: any;
}> = ({ onEditProfile, onWallet, onSettings, isCompact, styles }) => {
  const theme = useTheme();
  const labelProps = {
    numberOfLines: 1 as const,
    ellipsizeMode: 'tail' as const,
    maxFontSizeMultiplier: 1.1 as const,
  };

  const iconProps = {
    size: 16,
    style: {} as const,
    strokeWidth: undefined as any,
  };

  if (isCompact) {
    return (
      <View style={[styles.actionsContainer, { flexDirection: 'column', gap: theme.spacing.sm }]}>
        <TouchableOpacity
          style={[styles.primaryActionBtn, { flex: undefined, width: '100%' }]}
          onPress={onEditProfile}
          activeOpacity={0.85}
        >
          <View style={styles.primaryActionBtnGradient}>
            <Icon name={"create" as any} {...iconProps} color={theme.colors.textPrimary} />
            <Text style={styles.actionBtnText} {...labelProps}>Edit profile</Text>
          </View>
        </TouchableOpacity>

        <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
          <TouchableOpacity
            style={[styles.secondaryActionBtn, { flex: 1, minHeight: styles.primaryActionBtn?.minHeight }]}
            onPress={onWallet}
            activeOpacity={0.8}
          >
            <Icon name={"wallet" as any} {...iconProps} color={theme.colors.textSecondary} />
            <Text style={styles.secondaryActionText} {...labelProps}>Wallet</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.secondaryActionBtn, { flex: 1, minHeight: styles.primaryActionBtn?.minHeight }]}
            onPress={onSettings}
            activeOpacity={0.8}
          >
            <Icon name={"settings" as any} {...iconProps} color={theme.colors.textSecondary} />
            <Text style={styles.secondaryActionText} {...labelProps}>Settings</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.actionsContainer}>
      <TouchableOpacity style={[styles.primaryActionBtn, { flex: 1.4 }]} onPress={onEditProfile} activeOpacity={0.85}>
        <View style={styles.primaryActionBtnGradient}>
          <Icon name={"create" as any} {...iconProps} color={theme.colors.textPrimary} />
          <Text style={styles.actionBtnText} {...labelProps}>Edit profile</Text>
        </View>
      </TouchableOpacity>
      <TouchableOpacity style={[styles.secondaryActionBtn, { flex: 1 }]} onPress={onWallet} activeOpacity={0.8}>
        <Icon name={"wallet" as any} {...iconProps} color={theme.colors.textSecondary} />
        <Text style={styles.secondaryActionText} {...labelProps}>Wallet</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[styles.secondaryActionBtn, { flex: 1 }]} onPress={onSettings} activeOpacity={0.8}>
        <Icon name={"settings" as any} {...iconProps} color={theme.colors.textSecondary} />
        <Text style={styles.secondaryActionText} {...labelProps}>Settings</Text>
      </TouchableOpacity>
    </View>
  );
};

type PastLiveItem = {
  id: string;
  title: string;
  thumbnailUrl: string | null;
  peakViewerCount: number;
  likes: number;
  endedAtMs: number | null;
};

const pastLiveToMillis = (value: any): number | null => {
  if (!value) return null;
  if (typeof value === 'number') return value;
  if (typeof value?.toMillis === 'function') {
    try { return value.toMillis(); } catch { return null; }
  }
  if (typeof value?.seconds === 'number') return value.seconds * 1000;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
};

const formatPastLiveDate = (ms: number | null): string => {
  if (!ms) return '';
  try {
    return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
};

const ProfileSocialProof: React.FC<{ uid: string | null; onPastLives: () => void; styles: any; theme: BlypTheme }> = ({ uid, onPastLives, styles, theme }) => {
  const [items, setItems] = useState<PastLiveItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;
    if (!uid || !firebaseEnabled) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    (async () => {
      try {
        const snap = await db.collection('liveStreams').where('userId', '==', uid).limit(50).get();
        const rows: PastLiveItem[] = (snap?.docs || [])
          .map((d: any) => {
            const data = (typeof d.data === 'function' ? d.data() : d.data) || {};
            return {
              id: d.id,
              status: String(data.status || ''),
              title: String(data.title || 'Live stream'),
              thumbnailUrl: data.thumbnailUrl || data.hostPhotoURL || null,
              peakViewerCount: Number(data.peakViewerCount || data.totalViews || 0) || 0,
              likes: Number(data.likes || 0) || 0,
              endedAtMs: pastLiveToMillis(data.endedAt) ?? pastLiveToMillis(data.createdAt),
            };
          })
          // Past lives = anything that isn't currently broadcasting.
          .filter((r: any) => r.status !== 'live')
          .sort((a: any, b: any) => (b.endedAtMs || 0) - (a.endedAtMs || 0))
          .slice(0, 12)
          .map(({ status, ...rest }: any) => rest);

        if (!cancelled) setItems(rows);
      } catch (e: any) {
        try { console.warn('[PROFILE][WARN] past lives load failed', e?.message); } catch { }
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [uid]);

  return (
    <View style={styles.liveSection}>
      <View style={styles.liveSectionHeader}>
        <Text style={styles.liveSectionTitle}>Past Live Streams</Text>
        {items.length > 0 ? (
          <TouchableOpacity onPress={onPastLives} activeOpacity={0.7}>
            <Text style={styles.viewAllLink}>View all</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {loading ? (
        <View style={styles.liveEmptyState}>
          <ActivityIndicator color={theme.colors.accent} size="small" />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.liveEmptyState}>
          <Icon name={"radio" as any} size={28} color={theme.colors.textMuted} style={{}} strokeWidth={undefined} />
          <Text style={styles.liveEmptyText}>No live streams yet</Text>
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingVertical: 4, gap: 12 }}
        >
          {items.map((item) => (
            <TouchableOpacity
              key={item.id}
              activeOpacity={0.85}
              onPress={onPastLives}
              style={{
                width: 132,
                borderRadius: 14,
                overflow: 'hidden',
                backgroundColor: theme.colors.surface,
                borderWidth: 1,
                borderColor: theme.colors.border,
              }}
            >
              <View style={{ width: '100%', height: 168, backgroundColor: theme.colors.card }}>
                {item.thumbnailUrl ? (
                  <Image source={{ uri: item.thumbnailUrl }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                ) : (
                  <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name={"radio" as any} size={28} color={theme.colors.textMuted} style={{}} strokeWidth={undefined} />
                  </View>
                )}
                <View style={{ position: 'absolute', top: 8, left: 8, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 }}>
                  <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>{formatPastLiveDate(item.endedAtMs)}</Text>
                </View>
              </View>
              <View style={{ padding: 8 }}>
                <Text numberOfLines={1} style={{ color: theme.colors.textPrimary, fontSize: 12, fontWeight: '600' }}>{item.title}</Text>
                <Text numberOfLines={1} style={{ color: theme.colors.textMuted, fontSize: 11, marginTop: 2 }}>
                  {`${item.peakViewerCount.toLocaleString()} views · ${item.likes.toLocaleString()} likes`}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  );
};

const ProfileLogout: React.FC<{ onLogout: () => void; styles: any }> = ({ onLogout, styles }) => {
  return (
    <View style={styles.logoutSection}>
      <TouchableOpacity style={styles.logoutBtn} onPress={onLogout} activeOpacity={0.8}>
        <Text style={styles.logoutBtnText}>Logout</Text>
      </TouchableOpacity>
    </View>
  );
};

const ProfileMenuTab: React.FC<{ onEditProfile: () => void; onPlans?: () => void; onTransparency?: () => void; onImport?: () => void; onHub?: () => void; onLogout: () => void; styles: any }> = ({ onEditProfile, onPlans, onTransparency, onImport, onHub, onLogout, styles }) => {
  const ent = useEntitlement();
  const planLabel = (() => {
    if (!ent) return 'Manage your plan';
    if (ent.trialing) {
      const d = ent.trialDaysLeft || 0;
      return `Free trial · ${d} day${d === 1 ? '' : 's'} left`;
    }
    if (ent.effectiveTier === 'plus') return 'Blyp Plus · active';
    if (ent.effectiveTier === 'plus_coins') return 'Blyp Plus + Coins · active';
    return 'Free plan';
  })();

  return (
    <View style={styles.tabPage}>
      <Text style={styles.tabPageTitle}>Menu</Text>

      <View style={styles.tabMenuList}>
        <TouchableOpacity style={styles.tabMenuItem} onPress={onEditProfile} activeOpacity={0.85}>
          <Text style={styles.tabMenuItemText}>Edit profile settings</Text>
          <Text style={styles.tabMenuChevron}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.tabMenuItem} onPress={onPlans} activeOpacity={0.85}>
          <View style={{ flex: 1 }}>
            <Text style={styles.tabMenuItemText}>Subscription &amp; plan</Text>
            <Text style={{ color: '#9CA3AF', fontSize: 12, marginTop: 2 }}>{planLabel}</Text>
          </View>
          <Text style={styles.tabMenuChevron}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.tabMenuItem} onPress={onHub} activeOpacity={0.85}>
          <Text style={styles.tabMenuItemText}>Your social hub</Text>
          <Text style={styles.tabMenuChevron}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.tabMenuItem} onPress={onImport} activeOpacity={0.85}>
          <Text style={styles.tabMenuItemText}>Bring your content (TikTok)</Text>
          <Text style={styles.tabMenuChevron}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.tabMenuItem} onPress={onTransparency} activeOpacity={0.85}>
          <Text style={styles.tabMenuItemText}>Transparency &amp; your data</Text>
          <Text style={styles.tabMenuChevron}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.tabMenuItem} onPress={onLogout} activeOpacity={0.85}>
          <Text style={styles.tabMenuItemText}>Log out</Text>
          <Text style={styles.tabMenuChevron}>›</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const ProfileTabPlaceholder: React.FC<{ activeTab: string; styles: any }> = ({ activeTab, styles }) => {
  return (
    <View style={[styles.centerArea, { paddingTop: 24 }]}>
      <Text style={styles.stateText}>{activeTab}</Text>
      <Text style={styles.stateSub}>Content coming soon</Text>
    </View>
  );
};

export default ProfileScreenV3;
