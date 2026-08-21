import React, { useEffect, useMemo, useState } from 'react';
import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { COLORS } from '../../styles/theme';
import { responsiveFont, responsiveSize } from '../../utils/scaleUtils';
import { subscribeToFollowingList } from '../../utils/followUtils';
import {
  fetchMessengerUserProfiles,
  resolveUserPhoto,
} from '../../services/messaging/resolveMessengerUser';
import { creatorAvatar, streamThumbnail } from '../../services/discoveryService';

const RECENT_RING = '#FF9F0A';

function hostId(stream) {
  return String(stream?.hostUid || stream?.userId || stream?.uid || stream?.creatorId || '').trim();
}

function hostName(stream) {
  const raw =
    stream?.hostUsername ||
    stream?.hostDisplayName ||
    stream?.username ||
    stream?.displayName ||
    'live';
  return String(raw).replace(/^@/, '');
}

function handle(user, fallback) {
  const raw =
    user?.username ||
    user?.displayName ||
    user?.name ||
    fallback ||
    'user';
  return String(raw).replace(/^@/, '');
}

/**
 * Instagram-style status row: LIVE (pink glow + badge), Recently (orange ring), Offline.
 * Live comes from discovery `getLiveNow`; people come from following + recents.
 */
export default function HomeStatusBubbles({
  uid,
  liveStreams = [],
  recentPeers = [],
  onOpenLive,
  onOpenProfile,
}) {
  const [followingIds, setFollowingIds] = useState([]);
  const [profiles, setProfiles] = useState(new Map());

  useEffect(() => {
    if (!uid) return undefined;
    return subscribeToFollowingList(uid, (set) => {
      const ids = [...(set || [])].map(String).filter(Boolean);
      setFollowingIds(ids);
    });
  }, [uid]);

  useEffect(() => {
    const extra = (recentPeers || []).map((p) => p.id).filter(Boolean);
    const liveHosts = (liveStreams || []).map(hostId).filter(Boolean);
    const ids = [...new Set([...followingIds, ...extra, ...liveHosts])].slice(0, 40);
    if (!ids.length) {
      setProfiles(new Map());
      return undefined;
    }
    let cancelled = false;
    fetchMessengerUserProfiles(ids).then((map) => {
      if (!cancelled) setProfiles(map || new Map());
    });
    return () => {
      cancelled = true;
    };
  }, [followingIds, liveStreams, recentPeers]);

  const bubbles = useMemo(() => {
    const liveByHost = new Map();
    for (const stream of liveStreams || []) {
      const id = hostId(stream);
      if (!id || liveByHost.has(id)) continue;
      liveByHost.set(id, stream);
    }

    const rows = [];
    const seen = new Set();

    for (const [id, stream] of liveByHost) {
      seen.add(id);
      const profile = profiles.get(id) || profiles.get(String(id)) || {};
      rows.push({
        id: `live:${id}`,
        userId: id,
        handle: handle(profile, hostName(stream)),
        photo:
          resolveUserPhoto(profile) ||
          creatorAvatar(profile) ||
          streamThumbnail(stream) ||
          null,
        status: 'live',
        stream,
      });
    }

    for (const peer of recentPeers || []) {
      const id = String(peer?.id || '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const profile = profiles.get(id) || {};
      rows.push({
        id: `recent:${id}`,
        userId: id,
        handle: handle(profile, peer.displayName || peer.username),
        photo: resolveUserPhoto(profile) || peer.photoURL || null,
        status: 'recent',
      });
    }

    for (const id of followingIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      const profile = profiles.get(id) || {};
      rows.push({
        id: `off:${id}`,
        userId: id,
        handle: handle(profile, id.slice(0, 8)),
        photo: resolveUserPhoto(profile) || creatorAvatar(profile) || null,
        status: 'offline',
      });
    }

    return rows.slice(0, 24);
  }, [liveStreams, recentPeers, followingIds, profiles]);

  if (bubbles.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {bubbles.map((b) => {
        const live = b.status === 'live';
        const recent = b.status === 'recent';
        const initial = (b.handle || '?').slice(0, 1).toUpperCase();
        return (
          <TouchableOpacity
            key={b.id}
            style={styles.item}
            activeOpacity={0.85}
            onPress={() => {
              if (live && b.stream) onOpenLive?.(b.stream);
              else onOpenProfile?.(b.userId, b.handle);
            }}
          >
            <View
              style={[
                styles.ring,
                live && styles.ringLive,
                recent && styles.ringRecent,
              ]}
            >
              {b.photo ? (
                <Image source={{ uri: b.photo }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.fallback]}>
                  <Text style={styles.initial}>{initial}</Text>
                </View>
              )}
              {live ? (
                <View style={styles.livePill}>
                  <Text style={styles.livePillText}>LIVE</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.handle} numberOfLines={1}>
              {b.handle}
            </Text>
            <Text style={[styles.meta, live && styles.metaLive, recent && styles.metaRecent]}>
              {live ? 'LIVE' : recent ? 'Recently' : 'Offline'}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const AV = responsiveSize(62);

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: 16,
    paddingBottom: 4,
    gap: 14,
  },
  item: {
    width: responsiveSize(76),
    alignItems: 'center',
  },
  ring: {
    width: AV + 8,
    height: AV + 8,
    borderRadius: (AV + 8) / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
    marginBottom: 6,
  },
  ringLive: {
    borderWidth: 3,
    borderColor: COLORS.primary,
    shadowColor: COLORS.primary,
    shadowOpacity: 0.55,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  ringRecent: {
    borderColor: RECENT_RING,
  },
  avatar: {
    width: AV,
    height: AV,
    borderRadius: AV / 2,
    backgroundColor: COLORS.backgroundLight,
  },
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: {
    color: COLORS.white,
    fontWeight: '800',
    fontSize: responsiveFont(18),
  },
  livePill: {
    position: 'absolute',
    bottom: -2,
    alignSelf: 'center',
    backgroundColor: COLORS.primary,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: COLORS.black,
  },
  livePillText: {
    color: COLORS.white,
    fontSize: responsiveFont(8),
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  handle: {
    color: COLORS.white,
    fontSize: responsiveFont(11),
    fontWeight: '700',
    width: '100%',
    textAlign: 'center',
  },
  meta: {
    color: COLORS.textMuted,
    fontSize: responsiveFont(10),
    fontWeight: '600',
    marginTop: 1,
  },
  metaLive: { color: COLORS.primary },
  metaRecent: { color: RECENT_RING },
});
