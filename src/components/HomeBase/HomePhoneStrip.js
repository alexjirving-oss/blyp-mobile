import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
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
import { messengerExtrasService } from '../../services/messaging/messengerExtrasService';
import {
  fetchMessengerUserProfiles,
  resolveUserPhoto,
} from '../../services/messaging/resolveMessengerUser';
import {
  openMessengerCalls,
  placeOutgoingCall,
  recentCallPeers,
} from '../../services/homeCallEntry';
import { useAuth } from '../../hooks/useCommon';

/**
 * Compact Home phone entry — recents + call-back on the existing CallScreen
 * / fullscreen incoming pipeline. Always visible so the feature is discoverable.
 */
export default function HomePhoneStrip({ navigation, uid: uidProp, compact = false }) {
  const { uid: authUid, user } = useAuth();
  const uid = uidProp || authUid;
  const [calls, setCalls] = useState([]);
  const [photos, setPhotos] = useState({});

  useEffect(() => {
    if (!uid || !firebaseEnabled || !firestore) {
      setCalls([]);
      return undefined;
    }
    return messengerExtrasService.subscribeToCalls(
      firestore,
      uid,
      (list) => setCalls(Array.isArray(list) ? list : []),
      () => setCalls([]),
    );
  }, [uid]);

  const recents = useMemo(() => recentCallPeers(calls, uid, compact ? 5 : 8), [calls, uid, compact]);

  useEffect(() => {
    const ids = recents.map((r) => r.id).filter(Boolean);
    if (!ids.length) return undefined;
    let cancelled = false;
    fetchMessengerUserProfiles(ids).then((map) => {
      if (cancelled) return;
      const next = {};
      ids.forEach((id) => {
        const p = map?.get?.(id) || map?.get?.(String(id));
        const uri = resolveUserPhoto(p);
        if (uri) next[id] = uri;
      });
      setPhotos(next);
    });
    return () => {
      cancelled = true;
    };
  }, [recents]);

  const myName = user?.displayName || user?.username || 'Someone';

  const callPeer = useCallback(
    (peer) => {
      if (!peer?.id) {
        openMessengerCalls(navigation);
        return;
      }
      placeOutgoingCall({
        navigation,
        uid,
        myName,
        peerId: peer.id,
        peerName: peer.displayName,
        peerAvatar: photos[peer.id] || null,
        conversationId: peer.conversationId,
      });
    },
    [navigation, uid, myName, photos],
  );

  return (
    <View style={[styles.wrap, compact && styles.wrapCompact]}>
      <View style={styles.top}>
        <TouchableOpacity
          style={styles.dial}
          onPress={() => openMessengerCalls(navigation)}
          activeOpacity={0.88}
          accessibilityRole="button"
          accessibilityLabel="Open phone"
        >
          <View style={styles.dialIcon}>
            <Icon name="call" size={16} color="#0A0A0C" />
          </View>
          <View style={styles.dialCopy}>
            <Text style={styles.dialTitle}>Phone</Text>
            <Text style={styles.dialSub} numberOfLines={1}>
              {recents.length ? 'Recents · tap to call back' : 'Call someone'}
            </Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.seeAll}
          onPress={() => openMessengerCalls(navigation)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.seeAllText}>Recents</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        <TouchableOpacity
          style={styles.person}
          onPress={() => navigation.navigate('FindPeople')}
          activeOpacity={0.88}
          accessibilityLabel="Find someone to call"
        >
          <View style={[styles.avatar, styles.newAvatar]}>
            <Icon name="add" size={20} color={COLORS.primary} />
          </View>
          <Text style={styles.name} numberOfLines={1}>
            New
          </Text>
        </TouchableOpacity>
        {recents.map((p) => {
          const uri = photos[p.id];
          const initial = (p.displayName || '?').slice(0, 1).toUpperCase();
          return (
            <TouchableOpacity
              key={p.id}
              style={styles.person}
              onPress={() => callPeer(p)}
              activeOpacity={0.88}
              accessibilityLabel={`Call ${p.displayName}`}
            >
              <View style={styles.avatarWrap}>
                {uri ? (
                  <Image source={{ uri }} style={styles.avatar} />
                ) : (
                  <View style={[styles.avatar, styles.avatarFallback]}>
                    <Text style={styles.initial}>{initial}</Text>
                  </View>
                )}
                {p.isMissed ? <View style={styles.missedDot} /> : null}
              </View>
              <Text style={[styles.name, p.isMissed && styles.nameMissed]} numberOfLines={1}>
                {p.displayName}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#101014',
    paddingTop: 10,
    paddingBottom: 12,
  },
  wrapCompact: {
    marginHorizontal: 16,
    marginBottom: 12,
  },
  top: {
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  dial: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    minWidth: 0,
  },
  dialIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dialCopy: { flex: 1, minWidth: 0 },
  dialTitle: {
    color: COLORS.textPrimary,
    fontSize: responsiveFont(15),
    fontWeight: '800',
  },
  dialSub: {
    color: COLORS.textSecondary,
    fontSize: responsiveFont(12),
    fontWeight: '600',
    marginTop: 1,
  },
  seeAll: { marginLeft: 8 },
  seeAllText: {
    color: COLORS.primary,
    fontSize: responsiveFont(13),
    fontWeight: '800',
  },
  row: {
    paddingHorizontal: 12,
    gap: 12,
  },
  person: {
    width: 64,
    alignItems: 'center',
  },
  avatarWrap: {
    width: 52,
    height: 52,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#1A1A20',
  },
  newAvatar: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 45, 85,0.35)',
  },
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: {
    color: COLORS.primary,
    fontSize: responsiveFont(16),
    fontWeight: '800',
  },
  missedDot: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#EF4444',
    borderWidth: 2,
    borderColor: '#101014',
  },
  name: {
    marginTop: 6,
    color: COLORS.textPrimary,
    fontSize: responsiveFont(11),
    fontWeight: '700',
    width: '100%',
    textAlign: 'center',
  },
  nameMissed: {
    color: '#F87171',
  },
});
