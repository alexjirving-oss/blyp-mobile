import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  FlatList,
  Image,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import Icon from '../Icon';
import { db, firebaseEnabled } from '../../config/firebase';
import {
  subscribeToFollowingList,
  subscribeToFollowersList,
} from '../../utils/followUtils';
import { pickPublicLabel, looksLikeRawId } from '../../utils/publicLabel';

const TEAL = '#FF2D55';

function initials(name) {
  const s = String(name || '').trim().replace(/^@/, '');
  return s ? s.charAt(0).toUpperCase() : '?';
}

async function loadPublicUser(uid) {
  if (!firebaseEnabled || !db?.collection || !uid) return null;
  try {
    const snap = await db.collection('users').doc(uid).get();
    const u = typeof snap?.data === 'function' ? snap.data() : null;
    if (!u) return { id: uid, displayName: 'Blyp user', username: '', photoURL: '' };
    return {
      id: uid,
      displayName: pickPublicLabel(u, { uid, fallback: 'Blyp user' }),
      username: looksLikeRawId(u.username) ? '' : String(u.username || '').replace(/^@/, '').trim(),
      photoURL: u.photoURL || u.avatar || u.photo || '',
    };
  } catch {
    return { id: uid, displayName: 'Blyp user', username: '', photoURL: '' };
  }
}

/**
 * Host invite picker: people the host follows or who follow them.
 * Selecting someone calls onInvite(user) (hostInviteGuest + push via live-service).
 */
export default function LiveInviteGuestsModal({
  visible,
  hostUid,
  onClose,
  onInvite,
  invitingUid = null,
}) {
  const [followingIds, setFollowingIds] = useState(() => new Set());
  const [followerIds, setFollowerIds] = useState(() => new Set());
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [invited, setInvited] = useState(() => new Set());

  useEffect(() => {
    if (!visible || !hostUid) return undefined;
    const unsubF = subscribeToFollowingList(hostUid, (set) => setFollowingIds(new Set(set || [])));
    const unsubR = subscribeToFollowersList(hostUid, (set) => setFollowerIds(new Set(set || [])));
    return () => {
      try { unsubF?.(); } catch { /* ignore */ }
      try { unsubR?.(); } catch { /* ignore */ }
    };
  }, [visible, hostUid]);

  useEffect(() => {
    if (!visible) return undefined;
    let cancelled = false;
    const ids = new Set([...followingIds, ...followerIds]);
    ids.delete(hostUid);
    if (ids.size === 0) {
      setPeople([]);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    (async () => {
      const rows = [];
      for (const id of ids) {
        // eslint-disable-next-line no-await-in-loop
        const u = await loadPublicUser(id);
        if (u) {
          rows.push({
            ...u,
            relation: followingIds.has(id) && followerIds.has(id)
              ? 'Friends'
              : followingIds.has(id)
                ? 'Following'
                : 'Follower',
          });
        }
      }
      rows.sort((a, b) => String(a.displayName).localeCompare(String(b.displayName)));
      if (!cancelled) {
        setPeople(rows);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [visible, hostUid, followingIds, followerIds]);

  useEffect(() => {
    if (!visible) {
      setQuery('');
      setInvited(new Set());
    }
  }, [visible]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^@/, '');
    if (!q) return people;
    return people.filter((p) => {
      const dn = String(p.displayName || '').toLowerCase();
      const un = String(p.username || '').toLowerCase();
      return dn.includes(q) || un.includes(q);
    });
  }, [people, query]);

  const handleInvite = useCallback(async (user) => {
    if (!user?.id || invitingUid) return;
    try {
      await onInvite?.(user);
      setInvited((prev) => new Set(prev).add(user.id));
    } catch {
      /* parent shows alert */
    }
  }, [onInvite, invitingUid]);

  const renderItem = ({ item }) => {
    const busy = invitingUid === item.id;
    const done = invited.has(item.id);
    return (
      <TouchableOpacity
        style={styles.row}
        activeOpacity={0.85}
        disabled={busy || done}
        onPress={() => handleInvite(item)}
      >
        {item.photoURL ? (
          <Image source={{ uri: item.photoURL }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback]}>
            <Text style={styles.avatarInitial} allowFontScaling={false}>{initials(item.displayName)}</Text>
          </View>
        )}
        <View style={styles.meta}>
          <Text style={styles.name} numberOfLines={1} allowFontScaling={false}>{item.displayName}</Text>
          <Text style={styles.sub} numberOfLines={1} allowFontScaling={false}>
            {item.username ? `@${item.username}` : item.relation}
            {item.username ? ` · ${item.relation}` : ''}
          </Text>
        </View>
        <View style={[styles.inviteChip, done && styles.inviteChipDone]}>
          {busy ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={styles.inviteChipText} allowFontScaling={false}>{done ? 'Sent' : 'Invite'}</Text>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <Modal visible={!!visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title} allowFontScaling={false}>Invite guests</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Icon name="close" size={22} color="#fff" />
            </TouchableOpacity>
          </View>
          <Text style={styles.hint} allowFontScaling={false}>
            People you follow or who follow you. They get a Blyp ping to join your live.
          </Text>
          <View style={styles.searchBox}>
            <Icon name="search" size={16} color="rgba(255,255,255,0.55)" />
            <TextInput
              style={styles.searchInput}
              placeholder="Search…"
              placeholderTextColor="rgba(255,255,255,0.45)"
              value={query}
              onChangeText={setQuery}
              autoCapitalize="none"
            />
          </View>
          {loading ? (
            <ActivityIndicator color={TEAL} style={{ marginTop: 28 }} />
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={(item) => item.id}
              renderItem={renderItem}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={filtered.length ? styles.list : styles.emptyWrap}
              ListEmptyComponent={
                <Text style={styles.empty} allowFontScaling={false}>
                  No followers or following yet. Grow your graph, or tap a viewer in chat to invite them.
                </Text>
              }
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '78%',
    backgroundColor: '#121214',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  title: { color: '#fff', fontWeight: '800', fontSize: 18 },
  hint: {
    color: 'rgba(255,255,255,0.62)',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  searchInput: { flex: 1, color: '#fff', fontSize: 14, padding: 0 },
  list: { paddingBottom: 12 },
  emptyWrap: { paddingVertical: 36, paddingHorizontal: 8 },
  empty: { color: 'rgba(255,255,255,0.55)', textAlign: 'center', fontSize: 13, lineHeight: 19 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#222' },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: '#fff', fontWeight: '800', fontSize: 16 },
  meta: { flex: 1, marginLeft: 12, marginRight: 8 },
  name: { color: '#fff', fontWeight: '700', fontSize: 14 },
  sub: { color: 'rgba(255,255,255,0.55)', fontSize: 12, marginTop: 2 },
  inviteChip: {
    backgroundColor: TEAL,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 7,
    minWidth: 64,
    alignItems: 'center',
  },
  inviteChipDone: { backgroundColor: 'rgba(255,255,255,0.14)' },
  inviteChipText: { color: '#FFFFFF', fontWeight: '800', fontSize: 12 },
});
