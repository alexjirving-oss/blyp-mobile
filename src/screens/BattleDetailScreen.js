// BattleDetailScreen — view a battle, respond to an invite, set a reminder, or
// jump into the live room. Adapts to who is viewing (creator, opponent, viewer)
// and the battle's status.

import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet, Text, TouchableOpacity, View, ScrollView, Image, ActivityIndicator, Alert,
} from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import Icon from '../components/Icon';
import { COLORS } from '../styles/theme';
import { responsiveFont, responsiveSize } from '../utils/scaleUtils';
import { useAuth } from '../hooks/useCommon';
import {
  subscribeBattle, acceptBattle, rejectBattle, cancelBattle, setBattleReminder,
  isStaked, battleSideFor, BATTLE_STATUS, JOIN_GRACE_MS,
} from '../services/battleService';

function fullWhen(ms) {
  try {
    return new Date(ms).toLocaleString([], { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}

function Avatar({ uri, name, size = 72, ring }) {
  const base = [styles.avatar, { width: size, height: size, borderRadius: size / 2 }, ring && { borderWidth: 3, borderColor: ring }];
  if (uri) return <Image source={{ uri }} style={base} />;
  return (
    <View style={[base, styles.avatarFallback]}>
      <Text style={[styles.avatarInitial, { fontSize: size / 3 }]}>{String(name || '?').charAt(0).toUpperCase()}</Text>
    </View>
  );
}

const BattleDetailScreen = ({ navigation, route }) => {
  const { battleId } = route?.params || {};
  const { uid } = useAuth();
  const [battle, setBattle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reminderSet, setReminderSet] = useState(false);

  useEffect(() => {
    if (!battleId) return undefined;
    const unsub = subscribeBattle(battleId, (b) => {
      setBattle(b);
      setLoading(false);
    });
    return () => { try { unsub && unsub(); } catch {} };
  }, [battleId]);

  const side = battle ? battleSideFor(battle, uid) : null;
  const isParticipant = !!side;
  const isInvitee = battle && battle.opponentUid === uid && battle.status === BATTLE_STATUS.PENDING;
  const score = battle?.score || { creator: 0, opponent: 0 };

  const goLive = useCallback(() => {
    if (!battle) return;
    // Both participants PUBLISH to one shared stage: the creator creates it, the
    // opponent joins the creator's session. Opponent must wait for the stage.
    if (side === 'opponent' && !battle.liveStreamId) {
      Alert.alert('Waiting for host', `${battle.creatorName} needs to start the battle first.`);
      return;
    }
    navigation.navigate('LiveStreamScreen', {
      mode: 'host',
      battleId: battle.id,
      battleRole: side,
      battleSessionId: side === 'opponent' ? battle.liveStreamId : undefined,
      title: battle.title,
    });
  }, [battle, side, navigation]);

  const watchLive = useCallback(() => {
    if (!battle) return;
    navigation.navigate('LiveStreamScreen', {
      mode: 'viewer',
      battleId: battle.id,
      streamId: battle.liveStreamId || undefined,
      hostUid: battle.creatorUid,
    });
  }, [battle, navigation]);

  const onAccept = useCallback(async () => {
    setBusy(true);
    const res = await acceptBattle(battle, uid);
    setBusy(false);
    if (!res.ok) {
      Alert.alert('Could not accept', res.reason === 'insufficient_funds' ? 'You do not have enough coins for the deposit.' : 'Please try again.');
    }
  }, [battle, uid]);

  const onReject = useCallback(async () => {
    setBusy(true);
    await rejectBattle(battle, uid);
    setBusy(false);
    navigation.goBack();
  }, [battle, uid, navigation]);

  const onCancel = useCallback(() => {
    Alert.alert('Cancel battle?', isStaked(battle) ? 'Deposits will be refunded in coins.' : 'This will withdraw the battle.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Cancel battle',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          await cancelBattle(battle, uid);
          setBusy(false);
          navigation.goBack();
        },
      },
    ]);
  }, [battle, uid, navigation]);

  const onRemind = useCallback(async () => {
    if (!battle) return;
    await setBattleReminder(battle, uid, 10);
    setReminderSet(true);
  }, [battle, uid]);

  if (loading) {
    return (
      <ScreenContainer>
        <View style={styles.center}><ActivityIndicator color={COLORS.primary} /></View>
      </ScreenContainer>
    );
  }

  if (!battle) {
    return (
      <ScreenContainer>
        <View style={styles.topRow}>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}><Icon name="chevron-back" size={24} color={COLORS.textPrimary} /></TouchableOpacity>
          <Text style={styles.title}>Battle</Text><View style={styles.backBtn} />
        </View>
        <View style={styles.center}><Text style={styles.muted}>This battle is no longer available.</Text></View>
      </ScreenContainer>
    );
  }

  const live = battle.status === BATTLE_STATUS.LIVE;
  const completed = battle.status === BATTLE_STATUS.COMPLETED;
  const startSoon = battle.scheduledStartAt - Date.now() < 5 * 60 * 1000;
  const withinJoinWindow = Date.now() < battle.scheduledStartAt + JOIN_GRACE_MS;
  const creatorWon = completed && battle.winnerUid === battle.creatorUid;
  const opponentWon = completed && battle.winnerUid === battle.opponentUid;

  return (
    <ScreenContainer>
      <View style={styles.topRow}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Icon name="chevron-back" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Battle</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {live && (
          <View style={styles.liveBadge}><View style={styles.liveDot} /><Text style={styles.liveText}>LIVE NOW</Text></View>
        )}

        <View style={styles.vsRow}>
          <View style={styles.side}>
            <Avatar uri={battle.creatorPhoto} name={battle.creatorName} ring={creatorWon ? COLORS.primary : undefined} />
            <Text style={styles.sideName} numberOfLines={1}>{battle.creatorName}</Text>
            {(live || completed) && <Text style={styles.scoreNum}>{score.creator}</Text>}
            {creatorWon && <Text style={styles.winnerTag}>WINNER</Text>}
          </View>
          <View style={styles.vsBadge}><Text style={styles.vsText}>VS</Text></View>
          <View style={styles.side}>
            <Avatar uri={battle.opponentPhoto} name={battle.opponentName} ring={opponentWon ? COLORS.primary : undefined} />
            <Text style={styles.sideName} numberOfLines={1}>{battle.opponentName}</Text>
            {(live || completed) && <Text style={styles.scoreNum}>{score.opponent}</Text>}
            {opponentWon && <Text style={styles.winnerTag}>WINNER</Text>}
          </View>
        </View>

        <Text style={styles.battleTitle}>{battle.title}</Text>

        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <Icon name="time-outline" size={responsiveFont(16)} color={COLORS.textSecondary} />
            <Text style={styles.infoText}>{fullWhen(battle.scheduledStartAt)}</Text>
          </View>
          {isStaked(battle) && (
            <View style={styles.infoRow}>
              <Icon name="server-outline" size={responsiveFont(16)} color={COLORS.primary} />
              <Text style={[styles.infoText, { color: COLORS.primary }]}>{battle.stakeCoins} coin deposit each (attendance bond)</Text>
            </View>
          )}
          {completed && (
            <View style={styles.infoRow}>
              <Icon name="trophy-outline" size={responsiveFont(16)} color={COLORS.textSecondary} />
              <Text style={styles.infoText}>{battle.winnerUid ? 'Winner declared' : 'It was a draw'}</Text>
            </View>
          )}
        </View>

        {/* Actions */}
        {isInvitee && (
          <View style={styles.actionsRow}>
            <TouchableOpacity style={[styles.actionBtn, styles.rejectBtn]} onPress={onReject} disabled={busy}>
              <Text style={styles.rejectText}>Decline</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionBtn, styles.acceptBtn]} onPress={onAccept} disabled={busy}>
              {busy ? <ActivityIndicator color="#0A0A0C" /> : (
                <Text style={styles.acceptText}>{isStaked(battle) ? `Accept · ${battle.stakeCoins} coins` : 'Accept'}</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {!isInvitee && isParticipant && battle.status === BATTLE_STATUS.SCHEDULED && (
          <>
            {(startSoon && withinJoinWindow) ? (
              <TouchableOpacity style={styles.primaryBtn} onPress={goLive}>
                <Icon name="videocam" size={responsiveFont(18)} color="#0A0A0C" />
                <Text style={styles.primaryText}>Go live now</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.waitCard}><Text style={styles.muted}>You can go live when it's almost time. We'll remind you.</Text></View>
            )}
            <TouchableOpacity style={styles.linkBtn} onPress={onCancel} disabled={busy}>
              <Text style={styles.linkText}>Cancel battle</Text>
            </TouchableOpacity>
          </>
        )}

        {isParticipant && live && (
          <TouchableOpacity style={styles.primaryBtn} onPress={goLive}>
            <Icon name="videocam" size={responsiveFont(18)} color="#0A0A0C" />
            <Text style={styles.primaryText}>Return to your battle</Text>
          </TouchableOpacity>
        )}

        {/* Viewer actions */}
        {!isParticipant && live && (
          <TouchableOpacity style={styles.primaryBtn} onPress={watchLive}>
            <Icon name="eye" size={responsiveFont(18)} color="#0A0A0C" />
            <Text style={styles.primaryText}>Watch battle</Text>
          </TouchableOpacity>
        )}

        {!isParticipant && battle.status === BATTLE_STATUS.SCHEDULED && (
          <TouchableOpacity style={[styles.primaryBtn, reminderSet && styles.primaryBtnDone]} onPress={onRemind} disabled={reminderSet}>
            <Icon name={reminderSet ? 'checkmark' : 'notifications-outline'} size={responsiveFont(18)} color="#0A0A0C" />
            <Text style={styles.primaryText}>{reminderSet ? 'Reminder set' : 'Remind me'}</Text>
          </TouchableOpacity>
        )}

        {completed && (
          <View style={styles.waitCard}><Text style={styles.muted}>This battle has ended.</Text></View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  muted: { color: COLORS.textSecondary, fontSize: responsiveFont(14) },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, marginBottom: 8, paddingTop: responsiveSize(8) },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { color: COLORS.textPrimary, fontSize: responsiveFont(18), fontWeight: '800' },
  content: { padding: responsiveSize(16), paddingBottom: responsiveSize(50) },
  liveBadge: { flexDirection: 'row', alignSelf: 'center', alignItems: 'center', gap: responsiveSize(6), backgroundColor: 'rgba(239,68,68,0.15)', borderRadius: responsiveSize(20), paddingVertical: responsiveSize(5), paddingHorizontal: responsiveSize(12), marginBottom: responsiveSize(14) },
  liveDot: { width: responsiveSize(8), height: responsiveSize(8), borderRadius: responsiveSize(4), backgroundColor: '#ef4444' },
  liveText: { color: '#ef4444', fontSize: responsiveFont(12), fontWeight: '800' },
  vsRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginTop: responsiveSize(8) },
  side: { alignItems: 'center', flex: 1 },
  sideName: { color: COLORS.textPrimary, fontSize: responsiveFont(14), fontWeight: '700', marginTop: responsiveSize(8), maxWidth: responsiveSize(120) },
  scoreNum: { color: COLORS.primary, fontSize: responsiveFont(28), fontWeight: '900', marginTop: responsiveSize(4) },
  winnerTag: { color: COLORS.primary, fontSize: responsiveFont(11), fontWeight: '800', marginTop: responsiveSize(2), letterSpacing: 1 },
  vsBadge: { width: responsiveSize(44), height: responsiveSize(44), borderRadius: responsiveSize(22), backgroundColor: 'rgba(0,210,190,0.12)', alignItems: 'center', justifyContent: 'center', marginTop: responsiveSize(18) },
  vsText: { color: COLORS.primary, fontWeight: '900', fontSize: responsiveFont(15) },
  avatar: { backgroundColor: '#222' },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: COLORS.textPrimary, fontWeight: '800' },
  battleTitle: { color: COLORS.textPrimary, fontWeight: '800', fontSize: responsiveFont(18), textAlign: 'center', marginTop: responsiveSize(18) },
  infoCard: { backgroundColor: COLORS.backgroundCard, borderRadius: responsiveSize(14), padding: responsiveSize(14), marginTop: responsiveSize(16), gap: responsiveSize(10) },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: responsiveSize(10) },
  infoText: { color: COLORS.textPrimary, fontSize: responsiveFont(13), flex: 1 },
  actionsRow: { flexDirection: 'row', gap: responsiveSize(12), marginTop: responsiveSize(22) },
  actionBtn: { flex: 1, borderRadius: responsiveSize(14), paddingVertical: responsiveSize(14), alignItems: 'center' },
  acceptBtn: { backgroundColor: COLORS.primary },
  acceptText: { color: '#0A0A0C', fontWeight: '800', fontSize: responsiveFont(15) },
  rejectBtn: { backgroundColor: COLORS.backgroundCard },
  rejectText: { color: COLORS.textSecondary, fontWeight: '700', fontSize: responsiveFont(15) },
  primaryBtn: { flexDirection: 'row', gap: responsiveSize(8), backgroundColor: COLORS.primary, borderRadius: responsiveSize(14), paddingVertical: responsiveSize(15), alignItems: 'center', justifyContent: 'center', marginTop: responsiveSize(22) },
  primaryBtnDone: { backgroundColor: '#9ca3af' },
  primaryText: { color: '#0A0A0C', fontWeight: '800', fontSize: responsiveFont(15) },
  waitCard: { backgroundColor: COLORS.backgroundCard, borderRadius: responsiveSize(12), padding: responsiveSize(16), marginTop: responsiveSize(22), alignItems: 'center' },
  linkBtn: { alignItems: 'center', paddingVertical: responsiveSize(14), marginTop: responsiveSize(6) },
  linkText: { color: '#ef4444', fontWeight: '700', fontSize: responsiveFont(14) },
});

export default BattleDetailScreen;
