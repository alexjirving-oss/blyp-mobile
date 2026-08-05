// RoomScreen — a hostless, open-seat group video room rendered as an N-tile grid.
//
// On entry the user joins as a SUBSCRIBE-only viewer and immediately sees the
// grid of current publishers. Empty tiles show a "Join" affordance: tapping
// claims an open seat on the shared IVS stage and starts publishing the user's
// own camera/mic — with NO host approval. If the room is full, the user stays a
// viewer and the empty tiles are locked.
//
// Layout truth comes from Firestore presence (occupiedSlots / participants),
// while live video comes from the IVS session (matched by userId). Native video
// views are Android-only (matching the rest of the app); other platforms show an
// avatar fallback so the grid still reads correctly.

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  ActivityIndicator,
  Alert,
  TextInput,
  Modal,
} from 'react-native';
import Icon from '../components/Icon';
import { COLORS } from '../styles/theme';
import { responsiveFont, responsiveSize } from '../utils/scaleUtils';
import { useAuth } from '../hooks/useCommon';
import { useIVSRoomSession } from '../live/ivs/hooks/useIVSRoomSession';
import { getNativeIVSBroadcastView, getNativeIVSRealTimeView } from '../live/ivs/native/views';
import {
  subscribeRoom,
  subscribeRoomParticipants,
  claimRoomAmbassador,
  pinRoomAmbassadorIntro,
  isRoomAmbassador,
} from '../services/roomsService';
import { shareRoom } from '../services/shareService';

function initialOf(name) {
  return String(name || '?').trim().charAt(0).toUpperCase() || '?';
}

function Tile({ children, style }) {
  return <View style={[styles.tile, style]}>{children}</View>;
}

function AvatarFallback({ name, label }) {
  return (
    <View style={styles.avatarFallback}>
      <View style={styles.avatarCircle}>
        <Text style={styles.avatarInitial}>{initialOf(name)}</Text>
      </View>
      {!!label && <Text style={styles.tileName} numberOfLines={1}>{label}</Text>}
    </View>
  );
}

export default function RoomScreen({ navigation, route }) {
  const { uid, user } = useAuth();
  const roomId = route?.params?.roomId;
  const title = route?.params?.title || 'Room';
  const topicLabel = route?.params?.topicLabel || '';

  const NativeBroadcastView = useMemo(() => getNativeIVSBroadcastView(), []);
  const NativeRealTimeView = useMemo(() => getNativeIVSRealTimeView(), []);

  const [roomDoc, setRoomDoc] = useState(null);
  const [presence, setPresence] = useState([]); // [{ uid, slotIndex, publishing, displayName }]
  const [claimingAmbassador, setClaimingAmbassador] = useState(false);
  const [introModal, setIntroModal] = useState(false);
  const [introDraft, setIntroDraft] = useState('');
  const [pinning, setPinning] = useState(false);

  const session = useIVSRoomSession({ roomId, enabled: !!roomId, displayName: undefined });
  const {
    connectionState,
    mode,
    participants,
    slotIndex: mySlotIndex,
    sessionId,
    error,
    roomFull,
    claimSeat,
    releaseSeat,
    isMicEnabled,
    isCameraEnabled,
    setMicEnabled,
    setCameraEnabled,
    switchCamera,
  } = session;

  // Firestore: authoritative seat layout + presence labels.
  useEffect(() => {
    if (!roomId) return undefined;
    const unsubRoom = subscribeRoom(roomId, setRoomDoc);
    const unsubParts = subscribeRoomParticipants(roomId, (rows) => setPresence(rows || []));
    return () => {
      try { unsubRoom && unsubRoom(); } catch {}
      try { unsubParts && unsubParts(); } catch {}
    };
  }, [roomId]);

  const capacity = roomDoc?.capacity || 8;
  const isPublisher = mode === 'publisher';

  // slotIndex -> presence row (publishers only).
  const seatByIndex = useMemo(() => {
    const map = new Map();
    for (const p of presence) {
      if (p.publishing && typeof p.slotIndex === 'number') map.set(p.slotIndex, p);
    }
    // Make sure our own freshly-claimed seat shows instantly (before Firestore echo).
    if (isPublisher && typeof mySlotIndex === 'number' && !map.has(mySlotIndex)) {
      map.set(mySlotIndex, { uid, slotIndex: mySlotIndex, publishing: true, displayName: 'You' });
    }
    return map;
  }, [presence, isPublisher, mySlotIndex, uid]);

  // userId -> IVS participant (for matching live remote video to a seat).
  const participantByUserId = useMemo(() => {
    const map = new Map();
    for (const p of participants) {
      if (p.userId) map.set(p.userId, p);
    }
    return map;
  }, [participants]);

  const onTapSeat = useCallback(async () => {
    const res = await claimSeat();
    if (res?.full) {
      Alert.alert('Room is full', 'All seats are taken right now. You can keep watching and grab a seat when one frees up.');
    }
  }, [claimSeat]);

  const onLeaveSeat = useCallback(() => {
    releaseSeat();
  }, [releaseSeat]);

  const onClose = useCallback(() => {
    navigation?.goBack?.();
  }, [navigation]);

  const publisherCount = seatByIndex.size;
  const emptyRoom = publisherCount === 0;
  const amAmbassador = isRoomAmbassador(roomDoc, uid);
  const displayName = user?.displayName || user?.username || undefined;

  const onShare = useCallback(() => {
    shareRoom({
      roomId,
      title: roomDoc?.title || title,
      topicLabel: roomDoc?.topicLabel || topicLabel,
    });
  }, [roomId, roomDoc, title, topicLabel]);

  const onClaimAmbassador = useCallback(() => {
    if (!uid) {
      Alert.alert('Sign in required', 'Sign in to become a page ambassador.');
      return;
    }
    Alert.alert(
      'Become a page ambassador?',
      'Welcome people, share the invite link, and optionally pin a short intro. Keep it light — no CMS.',
      [
        { text: 'Not now', style: 'cancel' },
        {
          text: 'Yes, I’m in',
          onPress: async () => {
            setClaimingAmbassador(true);
            try {
              await claimRoomAmbassador(roomId, displayName);
              await shareRoom({
                roomId,
                title: roomDoc?.title || title,
                topicLabel: roomDoc?.topicLabel || topicLabel,
              });
            } catch (e) {
              Alert.alert('Couldn’t claim', e?.message || 'Try again later.');
            } finally {
              setClaimingAmbassador(false);
            }
          },
        },
      ],
    );
  }, [uid, roomId, displayName, roomDoc, title, topicLabel]);

  const onPinIntro = useCallback(async () => {
    const text = introDraft.trim();
    if (!text) return;
    setPinning(true);
    try {
      await pinRoomAmbassadorIntro(roomId, text, displayName);
      setIntroModal(false);
      setIntroDraft('');
    } catch (e) {
      Alert.alert('Couldn’t pin intro', e?.message || 'Try again.');
    } finally {
      setPinning(false);
    }
  }, [introDraft, roomId, displayName]);

  const renderTile = (slotId) => {
    const seat = seatByIndex.get(slotId);

    // Occupied seat
    if (seat) {
      const isMe = seat.uid === uid || (isPublisher && slotId === mySlotIndex);
      const name = isMe ? 'You' : seat.displayName || 'Guest';

      // My own seat -> local camera preview.
      if (isMe && isPublisher) {
        return (
          <Tile key={`seat-${slotId}`} style={styles.tileActive}>
            {NativeBroadcastView ? (
              <NativeBroadcastView style={StyleSheet.absoluteFill} />
            ) : (
              <AvatarFallback name={name} />
            )}
            <View style={styles.tileBadgeRow}>
              {!isMicEnabled && <Icon name="mic-off" size={responsiveFont(12)} color="#fff" />}
              {!isCameraEnabled && <Icon name="videocam-off" size={responsiveFont(12)} color="#fff" />}
            </View>
            <View style={styles.tileNameTag}><Text style={styles.tileNameTagText} numberOfLines={1}>You</Text></View>
          </Tile>
        );
      }

      // Remote publisher -> live IVS video if we've matched their participant.
      const remote = participantByUserId.get(seat.uid);
      return (
        <Tile key={`seat-${slotId}`} style={styles.tileActive}>
          {remote && NativeRealTimeView ? (
            <NativeRealTimeView
              style={StyleSheet.absoluteFill}
              sessionId={sessionId}
              slotId={slotId}
              participantId={remote.participantId}
              remoteTrackCount={participants.length}
              zoom={16 / 9}
            />
          ) : (
            <AvatarFallback name={name} />
          )}
          <View style={styles.tileNameTag}><Text style={styles.tileNameTagText} numberOfLines={1}>{name}</Text></View>
        </Tile>
      );
    }

    // Empty seat
    const canJoin = !isPublisher && !roomFull;
    if (canJoin) {
      return (
        <TouchableOpacity key={`seat-${slotId}`} activeOpacity={0.85} onPress={onTapSeat} style={[styles.tile, styles.tileEmptyJoin]}>
          <View style={styles.joinPlus}><Text style={styles.joinPlusText}>+</Text></View>
          <Text style={styles.joinLabel}>Join</Text>
        </TouchableOpacity>
      );
    }
    return (
      <Tile key={`seat-${slotId}`} style={styles.tileEmpty}>
        <Icon name="ellipse-outline" size={responsiveFont(18)} color="rgba(255,255,255,0.15)" />
      </Tile>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Icon name="chevron-back" size={responsiveFont(24)} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <Text style={styles.headerTitle} numberOfLines={1}>{roomDoc?.title || title}</Text>
            {amAmbassador ? (
              <View style={styles.headerAmbassadorBadge}>
                <Icon name="ribbon-outline" size={responsiveFont(12)} color="#f59e0b" />
              </View>
            ) : null}
          </View>
          {!!(roomDoc?.topicLabel || topicLabel) && (
            <Text style={styles.headerSub} numberOfLines={1}>
              {roomDoc?.topicLabel || topicLabel} · {publisherCount}/{capacity}
            </Text>
          )}
        </View>
        <TouchableOpacity onPress={onShare} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Icon name="share-outline" size={responsiveFont(22)} color={COLORS.textPrimary} />
        </TouchableOpacity>
      </View>

      {roomDoc?.introPinned?.text ? (
        <View style={styles.introBanner}>
          <Icon name="pin" size={responsiveFont(14)} color={COLORS.primary} />
          <Text style={styles.introBannerText} numberOfLines={3}>
            {roomDoc.introPinned.text}
            {roomDoc.introPinned.byName ? ` — ${roomDoc.introPinned.byName}` : ''}
          </Text>
        </View>
      ) : null}

      {emptyRoom && !amAmbassador ? (
        <TouchableOpacity
          style={styles.emptyAmbassadorBanner}
          onPress={onClaimAmbassador}
          disabled={claimingAmbassador}
        >
          {claimingAmbassador ? (
            <ActivityIndicator color={COLORS.primary} />
          ) : (
            <>
              <Icon name="ribbon-outline" size={responsiveFont(18)} color={COLORS.primary} />
              <Text style={styles.emptyAmbassadorText}>
                Nobody here yet. Would you like to become a page ambassador?
              </Text>
            </>
          )}
        </TouchableOpacity>
      ) : null}

      {amAmbassador ? (
        <View style={styles.ambassadorDuties}>
          <Text style={styles.ambassadorDutiesLabel}>Page ambassador</Text>
          <View style={styles.ambassadorActions}>
            <TouchableOpacity style={styles.dutyBtn} onPress={onShare}>
              <Icon name="share-social-outline" size={responsiveFont(14)} color={COLORS.primary} />
              <Text style={styles.dutyBtnText}>Share invite</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.dutyBtn} onPress={() => setIntroModal(true)}>
              <Icon name="pin-outline" size={responsiveFont(14)} color={COLORS.primary} />
              <Text style={styles.dutyBtnText}>Pin intro</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {connectionState === 'connecting' && publisherCount === 0 ? (
        <View style={styles.loading}>
          <ActivityIndicator color={COLORS.primary} />
          <Text style={styles.loadingText}>Joining room…</Text>
        </View>
      ) : (
        <View style={styles.grid}>
          {Array.from({ length: capacity }, (_, i) => renderTile(i + 1))}
        </View>
      )}

      {!!error && <Text style={styles.errorText} numberOfLines={2}>{error}</Text>}

      <View style={styles.controlBar}>
        {isPublisher ? (
          <>
            <TouchableOpacity style={styles.ctrlBtn} onPress={() => setMicEnabled(!isMicEnabled)}>
              <Icon name={isMicEnabled ? 'mic' : 'mic-off'} size={responsiveFont(22)} color={COLORS.textPrimary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.ctrlBtn} onPress={() => setCameraEnabled(!isCameraEnabled)}>
              <Icon name={isCameraEnabled ? 'videocam' : 'videocam-off'} size={responsiveFont(22)} color={COLORS.textPrimary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.ctrlBtn} onPress={switchCamera}>
              <Icon name="camera-reverse" size={responsiveFont(22)} color={COLORS.textPrimary} />
            </TouchableOpacity>
            <TouchableOpacity style={[styles.primaryBtn, styles.leaveBtn]} onPress={onLeaveSeat}>
              <Text style={styles.leaveBtnText}>Leave seat</Text>
            </TouchableOpacity>
          </>
        ) : roomFull ? (
          <View style={styles.watchingPill}>
            <Icon name="eye" size={responsiveFont(16)} color={COLORS.textSecondary} />
            <Text style={styles.watchingText}>Room full · watching</Text>
          </View>
        ) : (
          <TouchableOpacity style={styles.primaryBtn} onPress={onTapSeat}>
            <Icon name="add" size={responsiveFont(18)} color="#0A0A0C" />
            <Text style={styles.primaryBtnText}>Join the room</Text>
          </TouchableOpacity>
        )}
      </View>

      <Modal visible={introModal} transparent animationType="fade" onRequestClose={() => setIntroModal(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Pin a welcome intro</Text>
            <Text style={styles.modalSub}>One short line newcomers see when they open this room.</Text>
            <TextInput
              style={styles.modalInput}
              value={introDraft}
              onChangeText={setIntroDraft}
              placeholder="e.g. Welcome — introduce yourself and share your team!"
              placeholderTextColor={COLORS.textSecondary}
              multiline
              maxLength={280}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setIntroModal(false)}>
                <Text style={styles.modalCancel}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalSave}
                onPress={onPinIntro}
                disabled={pinning || !introDraft.trim()}
              >
                {pinning ? <ActivityIndicator color="#0A0A0C" /> : <Text style={styles.modalSaveText}>Pin</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: responsiveSize(16),
    paddingVertical: responsiveSize(12),
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerCenter: { flex: 1, alignItems: 'center', paddingHorizontal: responsiveSize(8) },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: responsiveSize(6) },
  headerTitle: { color: COLORS.textPrimary, fontWeight: '800', fontSize: responsiveFont(17), maxWidth: '90%' },
  headerAmbassadorBadge: {
    padding: responsiveSize(2),
    borderRadius: responsiveSize(8),
    backgroundColor: 'rgba(245,158,11,0.15)',
  },
  headerSub: { color: COLORS.textSecondary, fontSize: responsiveFont(12), marginTop: 2 },
  introBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: responsiveSize(8),
    marginHorizontal: responsiveSize(16),
    marginTop: responsiveSize(10),
    padding: responsiveSize(12),
    borderRadius: responsiveSize(12),
    backgroundColor: 'rgba(0,210,190,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(0,210,190,0.2)',
  },
  introBannerText: { flex: 1, color: COLORS.textPrimary, fontSize: responsiveFont(13), lineHeight: responsiveFont(18) },
  emptyAmbassadorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: responsiveSize(10),
    marginHorizontal: responsiveSize(16),
    marginTop: responsiveSize(10),
    padding: responsiveSize(12),
    borderRadius: responsiveSize(12),
    backgroundColor: COLORS.backgroundCard,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  emptyAmbassadorText: { flex: 1, color: COLORS.primary, fontWeight: '600', fontSize: responsiveFont(13), lineHeight: responsiveFont(18) },
  ambassadorDuties: {
    marginHorizontal: responsiveSize(16),
    marginTop: responsiveSize(10),
    gap: responsiveSize(8),
  },
  ambassadorDutiesLabel: { color: '#f59e0b', fontWeight: '700', fontSize: responsiveFont(12) },
  ambassadorActions: { flexDirection: 'row', gap: responsiveSize(8) },
  dutyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: responsiveSize(6),
    paddingVertical: responsiveSize(8),
    paddingHorizontal: responsiveSize(12),
    borderRadius: responsiveSize(20),
    backgroundColor: 'rgba(0,210,190,0.10)',
  },
  dutyBtnText: { color: COLORS.primary, fontWeight: '700', fontSize: responsiveFont(12) },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    padding: responsiveSize(24),
  },
  modalCard: {
    backgroundColor: COLORS.backgroundCard,
    borderRadius: responsiveSize(16),
    padding: responsiveSize(18),
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  modalTitle: { color: COLORS.textPrimary, fontWeight: '800', fontSize: responsiveFont(16) },
  modalSub: { color: COLORS.textSecondary, fontSize: responsiveFont(12), marginTop: responsiveSize(6), marginBottom: responsiveSize(12) },
  modalInput: {
    minHeight: responsiveSize(80),
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: responsiveSize(12),
    padding: responsiveSize(12),
    color: COLORS.textPrimary,
    textAlignVertical: 'top',
    fontSize: responsiveFont(14),
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: responsiveSize(16),
    marginTop: responsiveSize(14),
  },
  modalCancel: { color: COLORS.textSecondary, fontWeight: '600', fontSize: responsiveFont(14) },
  modalSave: {
    backgroundColor: COLORS.primary,
    borderRadius: responsiveSize(20),
    paddingVertical: responsiveSize(10),
    paddingHorizontal: responsiveSize(18),
    minWidth: responsiveSize(64),
    alignItems: 'center',
  },
  modalSaveText: { color: '#0A0A0C', fontWeight: '800', fontSize: responsiveFont(14) },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: responsiveSize(10) },
  loadingText: { color: COLORS.textSecondary, fontSize: responsiveFont(13) },
  grid: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: responsiveSize(8),
    alignContent: 'flex-start',
  },
  tile: {
    width: '48%',
    aspectRatio: 3 / 4,
    margin: '1%',
    borderRadius: responsiveSize(14),
    backgroundColor: COLORS.backgroundCard,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  tileActive: { borderColor: 'rgba(0,210,190,0.4)' },
  tileEmpty: { borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.12)' },
  tileEmptyJoin: { borderStyle: 'dashed', borderColor: 'rgba(0,210,190,0.5)', backgroundColor: 'rgba(0,210,190,0.06)' },
  joinPlus: {
    width: responsiveSize(44),
    height: responsiveSize(44),
    borderRadius: responsiveSize(22),
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  joinPlusText: { color: '#0A0A0C', fontSize: responsiveFont(26), fontWeight: '800', lineHeight: responsiveFont(28) },
  joinLabel: { color: COLORS.primary, fontWeight: '700', fontSize: responsiveFont(13), marginTop: responsiveSize(6) },
  avatarFallback: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: responsiveSize(8) },
  avatarCircle: {
    width: responsiveSize(56),
    height: responsiveSize(56),
    borderRadius: responsiveSize(28),
    backgroundColor: COLORS.backgroundLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { color: COLORS.textPrimary, fontWeight: '800', fontSize: responsiveFont(22) },
  tileName: { color: COLORS.textSecondary, fontSize: responsiveFont(12) },
  tileNameTag: {
    position: 'absolute',
    left: responsiveSize(8),
    bottom: responsiveSize(8),
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: responsiveSize(8),
    paddingHorizontal: responsiveSize(8),
    paddingVertical: responsiveSize(3),
    maxWidth: '80%',
  },
  tileNameTagText: { color: '#fff', fontSize: responsiveFont(11), fontWeight: '600' },
  tileBadgeRow: { position: 'absolute', top: responsiveSize(8), right: responsiveSize(8), flexDirection: 'row', gap: responsiveSize(4) },
  errorText: { color: '#ef4444', fontSize: responsiveFont(12), textAlign: 'center', paddingHorizontal: responsiveSize(16), paddingBottom: responsiveSize(6) },
  controlBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: responsiveSize(12),
    paddingHorizontal: responsiveSize(16),
    paddingVertical: responsiveSize(14),
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  ctrlBtn: {
    width: responsiveSize(48),
    height: responsiveSize(48),
    borderRadius: responsiveSize(24),
    backgroundColor: COLORS.backgroundLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: responsiveSize(6),
    backgroundColor: COLORS.primary,
    borderRadius: responsiveSize(24),
    paddingVertical: responsiveSize(14),
    paddingHorizontal: responsiveSize(24),
    flex: 1,
  },
  primaryBtnText: { color: '#0A0A0C', fontWeight: '800', fontSize: responsiveFont(15) },
  leaveBtn: { backgroundColor: 'rgba(239,68,68,0.15)', flex: 0, paddingHorizontal: responsiveSize(18) },
  leaveBtnText: { color: '#ef4444', fontWeight: '800', fontSize: responsiveFont(14) },
  watchingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: responsiveSize(6),
    backgroundColor: COLORS.backgroundLight,
    borderRadius: responsiveSize(20),
    paddingVertical: responsiveSize(10),
    paddingHorizontal: responsiveSize(16),
  },
  watchingText: { color: COLORS.textSecondary, fontWeight: '600', fontSize: responsiveFont(13) },
});
