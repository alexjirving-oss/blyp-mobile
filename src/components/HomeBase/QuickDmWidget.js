// QuickDmWidget.js — message favorites / recent chats from Home.

import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Icon from '../Icon';
import { COLORS } from '../../styles/theme';
import { responsiveFont } from '../../utils/scaleUtils';
import { firestore, firebaseEnabled } from '../../config/firebase';
import { conversationsMessagingService } from '../../services/messaging';
import { fixStorageUrl } from '../../utils/urlUtils';

function otherParticipant(thread, uid) {
  const parts = thread?.participants || thread?.participantIds || [];
  const otherId = parts.find((id) => id && id !== uid) || null;
  const profiles = thread?.participantProfiles || thread?.participantsData || {};
  const profile = (otherId && (profiles[otherId] || profiles[String(otherId)])) || {};
  return {
    id: otherId,
    displayName: profile.displayName || profile.username || thread?.otherDisplayName || 'Chat',
    username: profile.username || profile.displayName || '',
    photoURL: fixStorageUrl(profile.photoURL || profile.avatarUrl || profile.profilePicture || ''),
  };
}

const QuickDmWidget = ({
  uid,
  navigation,
  config = {},
  editMode = false,
  onTogglePerson,
}) => {
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(true);

  const favoriteIds = useMemo(
    () => (Array.isArray(config.peopleIds) ? config.peopleIds.filter(Boolean) : []),
    [config.peopleIds]
  );

  useEffect(() => {
    if (!uid || !firebaseEnabled || !firestore) {
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    const unsub = conversationsMessagingService.subscribeToThreads(
      firestore,
      uid,
      (list) => {
        setThreads(Array.isArray(list) ? list.slice(0, 24) : []);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => {
      try {
        if (typeof unsub === 'function') unsub();
      } catch {
        /* ignore */
      }
    };
  }, [uid]);

  const people = useMemo(() => {
    const mapped = threads
      .map((t) => {
        const other = otherParticipant(t, uid);
        if (!other.id) return null;
        return {
          threadId: t.id,
          ...other,
          lastMessage: t.lastMessage || '',
          unread: Number(t.unreadCount?.[uid] || t.unreadCounts?.[uid] || 0) || 0,
        };
      })
      .filter(Boolean);

    if (favoriteIds.length > 0) {
      const byId = new Map(mapped.map((p) => [p.id, p]));
      const favs = favoriteIds.map((id) => byId.get(id)).filter(Boolean);
      // Keep favorites first; fill with recent if under 6.
      const favSet = new Set(favoriteIds);
      const rest = mapped.filter((p) => !favSet.has(p.id));
      return [...favs, ...rest].slice(0, 10);
    }
    return mapped.slice(0, 8);
  }, [threads, uid, favoriteIds]);

  const openChat = (person) => {
    if (editMode) {
      const isFav = favoriteIds.includes(person.id);
      onTogglePerson?.(person.id, !isFav);
      return;
    }
    navigation.navigate('ChatConversation', {
      chatId: person.threadId,
      conversationId: person.threadId,
      otherUser: {
        id: person.id,
        displayName: person.displayName,
        username: person.username,
        photoURL: person.photoURL,
      },
    });
  };

  return (
    <View>
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>Messages</Text>
        <TouchableOpacity
          onPress={() => navigation.navigate('Messenger')}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.editLink}>{editMode ? 'Favorites' : 'See all'}</Text>
        </TouchableOpacity>
      </View>

      {loading && people.length === 0 ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={COLORS.primary} />
        </View>
      ) : people.length === 0 ? (
        <TouchableOpacity
          style={styles.empty}
          activeOpacity={0.88}
          onPress={() => navigation.navigate('Messenger')}
        >
          <View style={styles.emptyOrb}>
            <Icon name="chatbubbles-outline" size={22} color={COLORS.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.emptyTitle}>Start messaging</Text>
            <Text style={styles.emptySub}>
              {editMode
                ? 'Open Messages, chat someone, then pin them here.'
                : 'Your recent chats will show up here for one-tap replies.'}
            </Text>
          </View>
          <Icon name="chevron-forward" size={18} color={COLORS.textMuted} />
        </TouchableOpacity>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
          {people.map((p) => {
            const isFav = favoriteIds.includes(p.id);
            const initial = (p.displayName || p.username || '?').slice(0, 1).toUpperCase();
            return (
              <TouchableOpacity
                key={p.id}
                style={[styles.person, editMode && isFav && styles.personFav]}
                activeOpacity={0.88}
                onPress={() => openChat(p)}
              >
                <View>
                  {p.photoURL ? (
                    <Image source={{ uri: p.photoURL }} style={styles.avatar} />
                  ) : (
                    <View style={[styles.avatar, styles.avatarFallback]}>
                      <Text style={styles.initial}>{initial}</Text>
                    </View>
                  )}
                  {p.unread > 0 && !editMode && <View style={styles.unreadDot} />}
                  {editMode && (
                    <View style={[styles.favBadge, isFav && styles.favBadgeOn]}>
                      <Icon name={isFav ? 'star' : 'star-outline'} size={11} color={isFav ? COLORS.black : COLORS.primary} />
                    </View>
                  )}
                </View>
                <Text style={styles.name} numberOfLines={1}>
                  {p.displayName || p.username || 'Chat'}
                </Text>
                {!editMode && !!p.lastMessage && (
                  <Text style={styles.preview} numberOfLines={1}>
                    {p.lastMessage}
                  </Text>
                )}
                {editMode && (
                  <Text style={styles.favHint}>{isFav ? 'Pinned' : 'Tap to pin'}</Text>
                )}
              </TouchableOpacity>
            );
          })}
          <TouchableOpacity
            style={styles.compose}
            activeOpacity={0.88}
            onPress={() => navigation.navigate('Messenger')}
          >
            <View style={styles.composeOrb}>
              <Icon name="create-outline" size={20} color={COLORS.primary} />
            </View>
            <Text style={styles.composeLabel}>New</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 18,
    marginBottom: 10,
  },
  sectionTitle: {
    color: COLORS.textPrimary,
    fontSize: responsiveFont(18),
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  editLink: { color: COLORS.primary, fontSize: responsiveFont(13), fontWeight: '700' },
  row: { paddingRight: 8, gap: 14, alignItems: 'flex-start' },
  person: { width: 76, alignItems: 'center' },
  personFav: {
    padding: 6,
    margin: -6,
    borderRadius: 16,
    backgroundColor: 'rgba(0,210,190,0.08)',
  },
  avatar: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: COLORS.backgroundCard,
    borderWidth: 2,
    borderColor: 'rgba(0,210,190,0.35)',
  },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  initial: { color: COLORS.textPrimary, fontSize: responsiveFont(18), fontWeight: '800' },
  unreadDot: {
    position: 'absolute',
    right: 2,
    top: 2,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: COLORS.primary,
    borderWidth: 2,
    borderColor: COLORS.pageBackground,
  },
  favBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: COLORS.backgroundCard,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  favBadgeOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  name: {
    color: COLORS.textPrimary,
    fontSize: responsiveFont(12),
    fontWeight: '700',
    marginTop: 8,
    textAlign: 'center',
    width: '100%',
  },
  preview: {
    color: COLORS.textMuted,
    fontSize: responsiveFont(10),
    marginTop: 2,
    textAlign: 'center',
    width: '100%',
  },
  favHint: {
    color: COLORS.primary,
    fontSize: responsiveFont(10),
    fontWeight: '700',
    marginTop: 4,
  },
  compose: { width: 76, alignItems: 'center' },
  composeOrb: {
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 1.5,
    borderColor: 'rgba(0,210,190,0.4)',
    borderStyle: 'dashed',
    backgroundColor: 'rgba(0,210,190,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  composeLabel: {
    color: COLORS.primary,
    fontSize: responsiveFont(12),
    fontWeight: '700',
    marginTop: 8,
  },
  loadingRow: { paddingVertical: 16, alignItems: 'flex-start' },
  empty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 16,
    backgroundColor: COLORS.backgroundCard,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  emptyOrb: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: 'rgba(0,210,190,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: { color: COLORS.textPrimary, fontSize: responsiveFont(14), fontWeight: '800' },
  emptySub: { color: COLORS.textMuted, fontSize: responsiveFont(12), marginTop: 2, lineHeight: 16 },
});

export default QuickDmWidget;
