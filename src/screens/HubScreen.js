// HubScreen.js
//
// Blyp Hub — Phase 0: "your calm command center".
//
// Ships the lowest-risk, cross-platform slice:
//   • "Your socials" launcher (open the apps you already use)
//   • "Post anywhere" outward share (native share sheet)
//   • Honest "coming soon" cards for the digest (all platforms) and the
//     on-device notification glance (Android only)
//
// Reads nothing from other apps; sends nothing to any server. Hub config is
// stored on-device only (see socialHubService).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as notif from '../native/notificationGlance';
import ScreenContainer from '../components/ScreenContainer';
import { COLORS } from '../styles/theme';
import { responsiveFont, responsiveSize } from '../utils/scaleUtils';
import { useAuth } from '../hooks/useCommon';
import { getFollowingPosts } from '../services/discoveryService';
import { postThumbnail } from '../services/blypAiService';
import { subscribeToFollowingList } from '../utils/followUtils';
import {
  HUB_PLATFORMS,
  getEnabledPlatforms,
  launchApp,
  shareOut,
  toggleApp,
} from '../services/socialHubService';

const BLYP_SHARE_URL = 'https://blyp.app';
const DIGEST_SEEN_KEY = 'blyp.hub.digestSeen.v1';

// Robustly turn a post's date/createdAt (millis | ISO | Firestore Timestamp) into ms.
function postTimeMs(p) {
  const v = (p && (p.date ?? p.createdAt)) || null;
  if (!v) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') { const t = Date.parse(v); return Number.isNaN(t) ? 0 : t; }
  if (typeof v === 'object') {
    if (typeof v.toMillis === 'function') { try { return v.toMillis(); } catch { /* ignore */ } }
    if (typeof v.seconds === 'number') return v.seconds * 1000;
    if (typeof v._seconds === 'number') return v._seconds * 1000;
  }
  return 0;
}

const HubScreen = ({ navigation }) => {
  const { uid } = useAuth();
  const [enabled, setEnabled] = useState([]);
  const [editing, setEditing] = useState(false);
  const [enabledIds, setEnabledIds] = useState(new Set());

  const refresh = useCallback(async () => {
    const list = await getEnabledPlatforms();
    setEnabled(list);
    setEnabledIds(new Set(list.map((p) => p.id)));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const onToggle = useCallback(async (id) => {
    const ids = await toggleApp(id);
    setEnabledIds(new Set(ids));
    await refresh();
  }, [refresh]);

  const onShare = useCallback(() => {
    shareOut({ message: 'I’m on Blyp — come find me.', url: BLYP_SHARE_URL });
  }, []);

  return (
    <ScreenContainer>
      <View style={styles.topRow}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation?.goBack?.()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="chevron-back" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Hub</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Brand promise — calm and factual, no competitor attacks. */}
        <View style={styles.promise}>
          <Ionicons name="shield-checkmark-outline" size={22} color={COLORS.primary} />
          <Text style={styles.promiseText}>
            Built different. Blyp brings your world into one calm place. We only ever touch what’s public or
            already yours — nothing here is sold or sent to us.
          </Text>
        </View>

        {/* MODULE C — Your socials launcher */}
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Your socials</Text>
          <TouchableOpacity onPress={() => setEditing((v) => !v)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.manage}>{editing ? 'Done' : 'Manage'}</Text>
          </TouchableOpacity>
        </View>

        {editing ? (
          <View style={styles.editList}>
            {HUB_PLATFORMS.map((p) => {
              const on = enabledIds.has(p.id);
              return (
                <TouchableOpacity key={p.id} style={styles.editRow} activeOpacity={0.8} onPress={() => onToggle(p.id)}>
                  <Ionicons name={p.icon} size={22} color={COLORS.textSecondary} />
                  <Text style={styles.editLabel}>{p.label}</Text>
                  <View style={[styles.checkbox, on && styles.checkboxOn]}>
                    {on && <Ionicons name="checkmark" size={14} color="#001b18" />}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        ) : enabled.length > 0 ? (
          <View style={styles.grid}>
            {enabled.map((p) => (
              <TouchableOpacity key={p.id} style={styles.tile} activeOpacity={0.85} onPress={() => launchApp(p)}>
                <View style={styles.tileIcon}>
                  <Ionicons name={p.icon} size={26} color={COLORS.textPrimary} />
                </View>
                <Text style={styles.tileLabel} numberOfLines={1}>{p.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : (
          <Text style={styles.emptyText}>Tap “Manage” to add the apps you use.</Text>
        )}

        {/* MODULE D — Post anywhere */}
        <View style={styles.postCard}>
          <View style={styles.postCardText}>
            <Text style={styles.postTitle}>Post anywhere</Text>
            <Text style={styles.postBlurb}>Share Blyp out to any app on your phone.</Text>
          </View>
          <TouchableOpacity style={styles.postBtn} activeOpacity={0.9} onPress={onShare}>
            <Ionicons name="share-social-outline" size={18} color="#001b18" />
            <Text style={styles.postBtnText}>Share</Text>
          </TouchableOpacity>
        </View>

        {/* MODULE A — Needs you (Android only; on-device notification glance) */}
        <NeedsYou />

        {/* MODULE B — What's new from your world (your Blyp follows, no algorithm) */}
        <WorldDigest navigation={navigation} uid={uid} />

        <Text style={styles.footNote}>
          Your hub is yours: which apps appear here is stored only on your device.
        </Text>
      </ScrollView>
    </ScreenContainer>
  );
};

// "Needs you" — an on-device glance at notifications across your apps (Android
// only; iOS has no system API for this). Read on the phone, never sent to us.
const NeedsYou = () => {
  const [granted, setGranted] = useState(false);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const ok = await notif.isAccessGranted();
    setGranted(ok);
    setItems(ok ? await notif.getRecent() : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!notif.isSupported()) { setLoading(false); return undefined; }
    refresh();
    // Re-check when the user returns from the system settings screen.
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') refresh(); });
    return () => { try { sub && sub.remove && sub.remove(); } catch { /* ignore */ } };
  }, [refresh]);

  // Prominent in-context consent disclosure required by Google Play before we
  // open the system notification-access settings for this sensitive permission.
  const requestAccess = useCallback(() => {
    Alert.alert(
      'Turn on notification access',
      'Blyp will read the notifications that appear on your phone so it can show them here in one calm place.\n\nThis happens entirely on your device. Your notifications are never uploaded, stored on our servers, sold, or shared with anyone.\n\nYou can switch this off at any time in Settings.',
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Continue', onPress: () => notif.openAccessSettings() },
      ],
    );
  }, []);

  // Hidden entirely where unsupported (iOS / no native module).
  if (!notif.isSupported()) return null;

  return (
    <View style={styles.digestCard}>
      <View style={styles.digestHead}>
        <Ionicons name="notifications-outline" size={18} color={COLORS.textPrimary} />
        <Text style={styles.digestTitle}>Needs you</Text>
        {granted && items.length > 0 && (
          <TouchableOpacity onPress={refresh} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="refresh" size={16} color={COLORS.primary} />
          </TouchableOpacity>
        )}
      </View>
      <Text style={styles.digestSub}>
        A single glance at what’s pinging you across your apps — read only on your phone, never sent to us.
      </Text>

      {loading ? (
        <ActivityIndicator color={COLORS.primary} style={{ marginVertical: 12 }} />
      ) : !granted ? (
        <TouchableOpacity style={styles.digestFindBtn} activeOpacity={0.85} onPress={requestAccess}>
          <Ionicons name="lock-open-outline" size={16} color="#001b18" />
          <Text style={styles.digestFindText}>Turn on notification access</Text>
        </TouchableOpacity>
      ) : items.length === 0 ? (
        <Text style={styles.needsEmpty}>All caught up — nothing waiting right now.</Text>
      ) : (
        <View>
          {items.slice(0, 8).map((n, i) => (
            <View key={`${n.pkg}-${n.postTime}-${i}`} style={styles.needsRow}>
              <View style={styles.needsAppDot}><Text style={styles.needsAppInitial}>{notif.appLabel(n.pkg).charAt(0)}</Text></View>
              <View style={styles.needsText}>
                <Text style={styles.needsApp}>{notif.appLabel(n.pkg)}</Text>
                <Text style={styles.needsTitle} numberOfLines={1}>{n.title || n.text || '—'}</Text>
                {!!n.title && !!n.text && <Text style={styles.needsBody} numberOfLines={1}>{n.text}</Text>}
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
};

// "What's new from your world" — newest posts from the people you follow on
// Blyp. No ranking, no algorithm: strictly newest-first. The "new" count is
// computed against an on-device last-seen timestamp (never sent anywhere).
const WorldDigest = ({ navigation, uid }) => {
  const [following, setFollowing] = useState(new Set());
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newCount, setNewCount] = useState(0);
  const seenAtRef = useRef(0);

  useEffect(() => {
    if (!uid) { setLoading(false); return undefined; }
    const unsub = subscribeToFollowingList(uid, setFollowing);
    return unsub;
  }, [uid]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(DIGEST_SEEN_KEY);
        seenAtRef.current = raw ? Number(raw) || 0 : 0;
      } catch { /* ignore */ }
      const ids = Array.from(following);
      if (ids.length === 0) { if (active) { setPosts([]); setLoading(false); } return; }
      const res = await getFollowingPosts(ids, 12);
      if (!active) return;
      const sorted = (res || []).slice().sort((a, b) => postTimeMs(b) - postTimeMs(a));
      setPosts(sorted);
      setNewCount(sorted.filter((p) => postTimeMs(p) > seenAtRef.current).length);
      setLoading(false);
      try { await AsyncStorage.setItem(DIGEST_SEEN_KEY, String(Date.now())); } catch { /* ignore */ }
    })();
    return () => { active = false; };
  }, [following]);

  const followCount = following.size;

  return (
    <View style={styles.digestCard}>
      <View style={styles.digestHead}>
        <Ionicons name="newspaper-outline" size={18} color={COLORS.textPrimary} />
        <Text style={styles.digestTitle}>What’s new from your world</Text>
        {newCount > 0 && (
          <View style={styles.newBadge}><Text style={styles.newBadgeText}>{newCount} new</Text></View>
        )}
      </View>
      <Text style={styles.digestSub}>
        {followCount > 0
          ? `From the ${followCount} ${followCount === 1 ? 'creator' : 'creators'} you follow — newest first, no algorithm.`
          : 'Follow a few creators and their newest posts land here — newest first, no algorithm.'}
      </Text>

      {loading ? (
        <ActivityIndicator color={COLORS.primary} style={{ marginVertical: 16 }} />
      ) : posts.length === 0 ? (
        <TouchableOpacity style={styles.digestFindBtn} activeOpacity={0.85} onPress={() => navigation?.navigate?.('FindPeople')}>
          <Ionicons name="person-add" size={16} color="#001b18" />
          <Text style={styles.digestFindText}>Find people</Text>
        </TouchableOpacity>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.digestRow}>
          {posts.map((p) => {
            const uri = postThumbnail(p);
            const isVideo = p.type === 'video' || !!p.videoUrl;
            return (
              <TouchableOpacity key={String(p.id)} style={styles.digestItem} activeOpacity={0.85} onPress={() => navigation?.navigate?.('MediaViewer', { post: p })}>
                <View style={styles.digestThumbWrap}>
                  {uri ? (
                    <Image source={{ uri }} style={styles.digestThumb} resizeMode="cover" />
                  ) : (
                    <View style={[styles.digestThumb, styles.digestThumbFallback]}>
                      <Ionicons name="image-outline" size={22} color={COLORS.textMuted} />
                    </View>
                  )}
                  {isVideo && (
                    <View style={styles.digestPlay}><Ionicons name="play" size={11} color="#fff" /></View>
                  )}
                </View>
                <Text style={styles.digestHandle} numberOfLines={1}>@{p.username || p.userDisplayName || 'user'}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: responsiveSize(8),
    marginBottom: 6,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { color: COLORS.textPrimary, fontSize: responsiveFont(18), fontWeight: '800' },
  scroll: { paddingHorizontal: 16, paddingBottom: 120 },

  promise: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(0,210,190,0.10)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(0,210,190,0.35)',
    padding: 14,
    marginTop: 12,
    marginBottom: 20,
  },
  promiseText: { flex: 1, color: COLORS.textPrimary, fontSize: responsiveFont(12.5), lineHeight: responsiveFont(18), fontWeight: '600' },

  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sectionTitle: { color: COLORS.textPrimary, fontSize: responsiveFont(16), fontWeight: '800' },
  manage: { color: COLORS.primary, fontSize: responsiveFont(13), fontWeight: '700' },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginBottom: 22 },
  tile: { width: 72, alignItems: 'center', gap: 6 },
  tileIcon: {
    width: 60, height: 60, borderRadius: 18,
    backgroundColor: COLORS.backgroundCard, borderWidth: 1, borderColor: COLORS.border,
    alignItems: 'center', justifyContent: 'center',
  },
  tileLabel: { color: COLORS.textSecondary, fontSize: responsiveFont(11), fontWeight: '600' },
  emptyText: { color: COLORS.textMuted, fontSize: responsiveFont(13), marginBottom: 22 },

  editList: { marginBottom: 22 },
  editRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  editLabel: { flex: 1, color: COLORS.textPrimary, fontSize: responsiveFont(14), fontWeight: '600' },
  checkbox: {
    width: 24, height: 24, borderRadius: 7, borderWidth: 1.5, borderColor: COLORS.border,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },

  postCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: COLORS.backgroundCard, borderRadius: 14, borderWidth: 1, borderColor: COLORS.border,
    padding: 16, marginBottom: 20,
  },
  postCardText: { flex: 1, paddingRight: 12 },
  postTitle: { color: COLORS.textPrimary, fontSize: responsiveFont(15), fontWeight: '800', marginBottom: 3 },
  postBlurb: { color: COLORS.textSecondary, fontSize: responsiveFont(12.5), lineHeight: responsiveFont(17) },
  postBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: COLORS.primary, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10 },
  postBtnText: { color: '#001b18', fontSize: responsiveFont(13), fontWeight: '800' },

  digestCard: {
    backgroundColor: COLORS.backgroundCard, borderRadius: 14, borderWidth: 1, borderColor: COLORS.border,
    padding: 16, marginBottom: 12,
  },
  digestHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  digestTitle: { color: COLORS.textPrimary, fontSize: responsiveFont(14), fontWeight: '800', flex: 1 },
  newBadge: { backgroundColor: COLORS.primary, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  newBadgeText: { color: '#001b18', fontSize: responsiveFont(10), fontWeight: '800' },
  digestSub: { color: COLORS.textSecondary, fontSize: responsiveFont(12.5), lineHeight: responsiveFont(18), marginBottom: 12 },
  digestRow: { gap: 12, paddingRight: 4 },
  digestItem: { width: 88 },
  digestThumbWrap: { position: 'relative', width: 88, height: 88, borderRadius: 12, overflow: 'hidden' },
  digestThumb: { width: '100%', height: '100%', backgroundColor: 'rgba(255,255,255,0.06)' },
  digestThumbFallback: { alignItems: 'center', justifyContent: 'center' },
  digestPlay: {
    position: 'absolute', bottom: 6, right: 6, width: 20, height: 20, borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center',
  },
  digestHandle: { color: COLORS.textSecondary, fontSize: responsiveFont(11), fontWeight: '600', marginTop: 6 },
  digestFindBtn: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 8,
    backgroundColor: COLORS.primary, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10, marginTop: 4,
  },
  digestFindText: { color: '#001b18', fontSize: responsiveFont(13), fontWeight: '800' },

  needsEmpty: { color: COLORS.textMuted, fontSize: responsiveFont(13), paddingVertical: 4 },
  needsRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border },
  needsAppDot: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(0,210,190,0.15)', alignItems: 'center', justifyContent: 'center' },
  needsAppInitial: { color: COLORS.primary, fontSize: responsiveFont(15), fontWeight: '800' },
  needsText: { flex: 1 },
  needsApp: { color: COLORS.textMuted, fontSize: responsiveFont(11), fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  needsTitle: { color: COLORS.textPrimary, fontSize: responsiveFont(13), fontWeight: '600' },
  needsBody: { color: COLORS.textSecondary, fontSize: responsiveFont(12) },

  soonCard: {
    backgroundColor: COLORS.backgroundCard, borderRadius: 14, borderWidth: 1, borderColor: COLORS.border,
    padding: 16, marginBottom: 12, opacity: 0.85,
  },
  soonHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  soonTitle: { color: COLORS.textPrimary, fontSize: responsiveFont(14), fontWeight: '800', flex: 1 },
  soonTag: { backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  soonTagText: { color: COLORS.textMuted, fontSize: responsiveFont(10), fontWeight: '700' },
  soonBlurb: { color: COLORS.textSecondary, fontSize: responsiveFont(12.5), lineHeight: responsiveFont(18) },

  footNote: { color: COLORS.textMuted, fontSize: responsiveFont(12), lineHeight: responsiveFont(18), marginTop: 14 },
});

export default HubScreen;
