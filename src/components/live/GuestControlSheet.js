import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Image,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import Icon from '../Icon';
import {
  isFollowing,
  followUser,
  unfollowUser,
  getFollowersCount,
  getFollowingCount,
  getMutualFollowCount,
} from '../../utils/followUtils';

const TEAL = '#00D2BE';
const ROSE = '#FB7185';
const BG = '#121214';
const SURFACE = 'rgba(255,255,255,0.06)';
const BORDER = 'rgba(255,255,255,0.10)';

function initialsFor(name) {
  const s = String(name || '').trim();
  if (!s) return '?';
  return s.replace(/^@/, '').slice(0, 1).toUpperCase();
}

function formatDuration(ms) {
  if (!ms || ms < 0) return null;
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${total}s`;
}

function Avatar({ uri, name, size, ring }) {
  const r = size / 2;
  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={{ width: size, height: size, borderRadius: r, borderWidth: ring ? 2 : 0, borderColor: TEAL }}
      />
    );
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: r,
        backgroundColor: 'rgba(255,255,255,0.12)',
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: ring ? 2 : 0,
        borderColor: TEAL,
      }}
    >
      <Text style={{ color: '#fff', fontWeight: '800', fontSize: size * 0.4 }} allowFontScaling={false}>
        {initialsFor(name)}
      </Text>
    </View>
  );
}

/**
 * Host-only Guest Control sheet. One reusable sheet for every on-stage guest:
 * a top switcher selects which guest you're acting on, then identity +
 * relationship + session stats + gift + moderation (mute / camera / report /
 * disconnect) all target the selected guest.
 */
export default function GuestControlSheet({
  visible,
  guests = [],
  selectedGuestId,
  onSelectGuest,
  onClose,
  currentUserId,
  mutedGuestIds,
  cameraOffGuestIds,
  onToggleMute,
  onToggleCamera,
  onKick,
  onReport,
  onGift,
  onOpenProfile,
  onChallenge,
  canChallenge = false,
  challengeBusy = false,
  giftTotalsByUser = {},
  joinedAtByUser = {},
}) {
  const selected = useMemo(
    () => guests.find((g) => (g.userId || g.participantId) === selectedGuestId) || guests[0] || null,
    [guests, selectedGuestId]
  );
  const selectedId = selected ? selected.userId || selected.participantId : null;

  const [rel, setRel] = useState({ loading: false });
  const [relBusy, setRelBusy] = useState(false);
  const [nowTick, setNowTick] = useState(Date.now());

  // Tick once a minute (and on open) so "time on stage" stays current.
  useEffect(() => {
    if (!visible) return undefined;
    setNowTick(Date.now());
    const t = setInterval(() => setNowTick(Date.now()), 30000);
    return () => clearInterval(t);
  }, [visible, selectedId]);

  // Load relationship + counts whenever the selected guest changes.
  useEffect(() => {
    if (!visible || !selectedId || !currentUserId || selectedId === currentUserId) {
      setRel({ loading: false });
      return undefined;
    }
    let cancelled = false;
    setRel({ loading: true });
    (async () => {
      try {
        const [iFollow, followsMe, followers, following, mutual] = await Promise.all([
          isFollowing(currentUserId, selectedId),
          isFollowing(selectedId, currentUserId),
          getFollowersCount(selectedId),
          getFollowingCount(selectedId),
          getMutualFollowCount(currentUserId, selectedId),
        ]);
        if (!cancelled) setRel({ loading: false, iFollow, followsMe, followers, following, mutual });
      } catch {
        if (!cancelled) setRel({ loading: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, selectedId, currentUserId]);

  const toggleFollow = async () => {
    if (!selectedId || !currentUserId || relBusy) return;
    const next = !rel.iFollow;
    setRelBusy(true);
    setRel((p) => ({ ...p, iFollow: next, followers: (p.followers || 0) + (next ? 1 : -1) }));
    try {
      const res = next
        ? await followUser(currentUserId, selectedId)
        : await unfollowUser(currentUserId, selectedId);
      if (!res?.success) throw res?.error || new Error('follow write failed');
    } catch {
      setRel((p) => ({ ...p, iFollow: !next, followers: (p.followers || 0) + (next ? -1 : 1) }));
    } finally {
      setRelBusy(false);
    }
  };

  if (!visible || !selected) return null;

  const relationshipLabel = rel.loading
    ? '…'
    : rel.iFollow && rel.followsMe
      ? 'Friends'
      : rel.iFollow
        ? 'Following'
        : rel.followsMe
          ? 'Follows you'
          : 'Not following';

  const isMuted = mutedGuestIds?.has?.(selectedId);
  const isCamOff = cameraOffGuestIds?.has?.(selectedId);
  const onStage = formatDuration(nowTick - (joinedAtByUser[selectedId] || 0));
  const gifts = giftTotalsByUser[selectedId] || { count: 0, coins: 0 };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={styles.sheet} onPress={() => {}}>
          <View style={styles.grabber} />

          {/* Guest switcher */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.switcherRow}
          >
            {guests.map((g) => {
              const gid = g.userId || g.participantId;
              const active = gid === selectedId;
              return (
                <TouchableOpacity key={gid} style={styles.switcherItem} onPress={() => onSelectGuest?.(gid)} activeOpacity={0.85}>
                  <Avatar uri={g.photoUrl} name={g.name} size={48} ring={active} />
                  <Text
                    style={[styles.switcherName, active && { color: '#fff' }]}
                    numberOfLines={1}
                    allowFontScaling={false}
                  >
                    {g.name || `Slot ${g.slotIndex || ''}`}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <View style={styles.divider} />

          {/* Identity */}
          <View style={styles.identityRow}>
            <Avatar uri={selected.photoUrl} name={selected.name} size={56} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.identityName} numberOfLines={1} allowFontScaling={false}>
                {selected.name || 'Guest'}
              </Text>
              <View style={styles.relPillRow}>
                <View style={styles.relPill}>
                  <Text style={styles.relPillText} allowFontScaling={false}>{relationshipLabel}</Text>
                </View>
                {typeof selected.slotIndex === 'number' ? (
                  <Text style={styles.slotText} allowFontScaling={false}>Box {selected.slotIndex}</Text>
                ) : null}
              </View>
            </View>
            <TouchableOpacity
              style={[styles.followBtn, rel.iFollow && styles.followBtnActive]}
              onPress={toggleFollow}
              disabled={relBusy}
              activeOpacity={0.85}
            >
              <Text style={[styles.followBtnText, rel.iFollow && { color: '#fff' }]} allowFontScaling={false}>
                {rel.iFollow ? 'Following' : 'Follow'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Stats */}
          <View style={styles.statsRow}>
            <View style={styles.stat}>
              <Text style={styles.statValue} allowFontScaling={false}>{rel.followers ?? '—'}</Text>
              <Text style={styles.statLabel} allowFontScaling={false}>Followers</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statValue} allowFontScaling={false}>{rel.following ?? '—'}</Text>
              <Text style={styles.statLabel} allowFontScaling={false}>Following</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statValue} allowFontScaling={false}>{rel.mutual ?? '—'}</Text>
              <Text style={styles.statLabel} allowFontScaling={false}>Mutual</Text>
            </View>
            {onStage ? (
              <View style={styles.stat}>
                <Text style={styles.statValue} allowFontScaling={false}>{onStage}</Text>
                <Text style={styles.statLabel} allowFontScaling={false}>On stage</Text>
              </View>
            ) : null}
            {gifts.count > 0 ? (
              <View style={styles.stat}>
                <Text style={styles.statValue} allowFontScaling={false}>{gifts.coins}</Text>
                <Text style={styles.statLabel} allowFontScaling={false}>Gift coins</Text>
              </View>
            ) : null}
          </View>

          {/* Primary actions */}
          <View style={styles.primaryRow}>
            <TouchableOpacity style={styles.giftBtn} onPress={() => onGift?.(selected)} activeOpacity={0.85}>
              <Icon name="gift" size={18} color="#0A0A0C" />
              <Text style={styles.giftBtnText} allowFontScaling={false}>Send gift</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.profileBtn} onPress={() => onOpenProfile?.(selected)} activeOpacity={0.85}>
              <Icon name="person" size={18} color="#fff" />
              <Text style={styles.profileBtnText} allowFontScaling={false}>Profile</Text>
            </TouchableOpacity>
          </View>

          {canChallenge && typeof onChallenge === 'function' ? (
            <TouchableOpacity
              style={styles.challengeBtn}
              onPress={() => onChallenge?.(selected)}
              disabled={challengeBusy}
              activeOpacity={0.85}
            >
              {challengeBusy ? (
                <ActivityIndicator color="#0A0A0C" />
              ) : (
                <>
                  <Icon name="flash" size={18} color="#0A0A0C" />
                  <Text style={styles.challengeBtnText} allowFontScaling={false}>
                    Challenge this guest
                  </Text>
                </>
              )}
            </TouchableOpacity>
          ) : null}

          {/* Moderation */}
          <Text style={styles.sectionLabel} allowFontScaling={false}>Host controls</Text>
          <View style={styles.modRow}>
            <ModButton
              icon={isMuted ? 'mic-off' : 'mic'}
              label={isMuted ? 'Unmute' : 'Mute'}
              active={isMuted}
              onPress={() => onToggleMute?.(selected)}
            />
            <ModButton
              icon={isCamOff ? 'videocam-off' : 'videocam'}
              label={isCamOff ? 'Camera on' : 'Camera off'}
              active={isCamOff}
              onPress={() => onToggleCamera?.(selected)}
            />
            <ModButton icon="flag" label="Report" onPress={() => onReport?.(selected)} />
            <ModButton icon="close-circle" label="Disconnect" danger onPress={() => onKick?.(selected)} />
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

function ModButton({ icon, label, active, danger, onPress }) {
  const color = danger ? ROSE : active ? TEAL : '#fff';
  return (
    <TouchableOpacity style={styles.modBtn} onPress={onPress} activeOpacity={0.85}>
      <View style={[styles.modIconWrap, active && { backgroundColor: 'rgba(0,210,190,0.16)' }, danger && { backgroundColor: 'rgba(251,113,133,0.16)' }]}>
        <Icon name={icon} size={20} color={color} />
      </View>
      <Text style={[styles.modLabel, { color: danger ? ROSE : '#D4D4D8' }]} allowFontScaling={false}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: BG,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 28,
    borderTopWidth: 1,
    borderColor: BORDER,
  },
  grabber: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.25)', marginBottom: 12 },
  switcherRow: { gap: 14, paddingHorizontal: 2, paddingBottom: 4 },
  switcherItem: { alignItems: 'center', width: 56 },
  switcherName: { color: '#A1A1AA', fontSize: 11, marginTop: 4, maxWidth: 56, textAlign: 'center' },
  divider: { height: 1, backgroundColor: BORDER, marginVertical: 12 },
  identityRow: { flexDirection: 'row', alignItems: 'center' },
  identityName: { color: '#fff', fontSize: 18, fontWeight: '800' },
  relPillRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  relPill: { backgroundColor: SURFACE, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  relPillText: { color: TEAL, fontSize: 12, fontWeight: '700' },
  slotText: { color: '#71717A', fontSize: 12, fontWeight: '600' },
  followBtn: { backgroundColor: TEAL, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8 },
  followBtnActive: { backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER },
  followBtnText: { color: '#0A0A0C', fontWeight: '800', fontSize: 13 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16, paddingHorizontal: 4 },
  stat: { alignItems: 'center', minWidth: 56 },
  statValue: { color: '#fff', fontSize: 16, fontWeight: '800' },
  statLabel: { color: '#71717A', fontSize: 11, marginTop: 2 },
  primaryRow: { flexDirection: 'row', gap: 12, marginTop: 18 },
  giftBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: TEAL, paddingVertical: 13, borderRadius: 14 },
  giftBtnText: { color: '#0A0A0C', fontWeight: '800', fontSize: 15 },
  profileBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER, paddingVertical: 13, borderRadius: 14 },
  profileBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  challengeBtn: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FF5A45',
    paddingVertical: 13,
    borderRadius: 14,
  },
  challengeBtnText: { color: '#0A0A0C', fontWeight: '900', fontSize: 15 },
  sectionLabel: { color: '#71717A', fontSize: 12, fontWeight: '700', marginTop: 20, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  modRow: { flexDirection: 'row', justifyContent: 'space-between' },
  modBtn: { alignItems: 'center', flex: 1, gap: 6 },
  modIconWrap: { width: 52, height: 52, borderRadius: 26, backgroundColor: SURFACE, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: BORDER },
  modLabel: { fontSize: 11, fontWeight: '600' },
});
