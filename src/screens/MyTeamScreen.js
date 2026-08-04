// MyTeamScreen — leader admin console + member view of a user's team.
//
// Leader sees: member roster with live hours, pending join requests to
// accept/decline, a group-message composer, and an "arrange battle" tool that
// pairs two members. Members see the roster, their own stats and recent battles.

import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  TextInput,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ScreenContainer from '../components/ScreenContainer';
import BlypAvatar from '../components/BlypAvatar';
import { COLORS } from '../styles/theme';
import { useAuth } from '../hooks/useCommon';
import {
  getMyMembership,
  subscribeTeam,
  subscribeTeamMembers,
  subscribeJoinRequests,
  subscribeTeamBattles,
  subscribeAuditions,
  acceptJoinRequest,
  declineJoinRequest,
  decideAudition,
  sendTeamGroupMessage,
  createTeamBattle,
  leaveTeam,
  TEAM_ROLE,
  AUDITION_STATUS,
} from '../services/teamsService';

const fmtHours = (h) => {
  const n = Number(h || 0);
  if (n <= 0) return '0h';
  if (n < 1) return `${Math.round(n * 60)}m`;
  return `${n.toFixed(n < 10 ? 1 : 0)}h`;
};

// Gems can be fractional in the dashboard (e.g. a 2.5-gem leader cut). Show up to
// one decimal, trimming a trailing ".0".
const fmtGems = (g) => {
  const n = Number(g || 0);
  if (!Number.isFinite(n) || n <= 0) return '0';
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
};

const memberTotalEarned = (m) =>
  Number(m?.gemsEarned || 0) + Number(m?.teamBonusGems || 0);

const MyTeamScreen = ({ navigation }) => {
  const { user, uid } = useAuth();
  const [loading, setLoading] = useState(true);
  const [membership, setMembership] = useState(null);
  const [liveTeam, setLiveTeam] = useState(null);
  const [members, setMembers] = useState([]);
  const [requests, setRequests] = useState([]);
  const [battles, setBattles] = useState([]);
  const [auditions, setAuditions] = useState([]);

  const [msgOpen, setMsgOpen] = useState(false);
  const [msgText, setMsgText] = useState('');
  const [sending, setSending] = useState(false);

  const [battleOpen, setBattleOpen] = useState(false);
  const [pickA, setPickA] = useState(null);
  const [pickB, setPickB] = useState(null);
  const [creatingBattle, setCreatingBattle] = useState(false);

  const loadMembership = useCallback(async () => {
    if (!uid) return;
    const m = await getMyMembership(uid);
    setMembership(m);
    setLoading(false);
  }, [uid]);

  useEffect(() => { loadMembership(); }, [loadMembership]);

  const teamId = membership?.teamId || null;
  const isLeader = membership?.team?.leaderId === uid;

  useEffect(() => {
    if (!teamId) return undefined;
    const unsubT = subscribeTeam(teamId, setLiveTeam);
    const unsubM = subscribeTeamMembers(teamId, setMembers);
    const unsubB = subscribeTeamBattles(teamId, setBattles);
    const unsubR = isLeader ? subscribeJoinRequests(teamId, setRequests) : null;
    const unsubA = isLeader ? subscribeAuditions(teamId, setAuditions) : null;
    return () => {
      try { unsubT && unsubT(); } catch {}
      try { unsubM && unsubM(); } catch {}
      try { unsubB && unsubB(); } catch {}
      try { unsubR && unsubR(); } catch {}
      try { unsubA && unsubA(); } catch {}
    };
  }, [teamId, isLeader]);

  const onAuditionDecision = async (auditionId, candidateUid, decision) => {
    try {
      await decideAudition(auditionId, candidateUid, decision);
    } catch (e) {
      Alert.alert('Could not save decision', e?.message || 'Please try again.');
    }
  };

  const onAccept = async (req) => {
    try { await acceptJoinRequest(teamId, req); } catch (e) { Alert.alert('Could not accept', e?.message || ''); }
  };
  const onDecline = async (req) => {
    try { await declineJoinRequest(teamId, req); } catch (e) { Alert.alert('Could not decline', e?.message || ''); }
  };

  const sendGroupMessage = async () => {
    if (!msgText.trim()) return;
    setSending(true);
    try {
      await sendTeamGroupMessage(teamId, user || { uid }, msgText.trim());
      setMsgOpen(false);
      setMsgText('');
      Alert.alert('Sent', 'Your message was sent to every team member.');
    } catch (e) {
      Alert.alert('Could not send', e?.message || 'Please try again.');
    } finally {
      setSending(false);
    }
  };

  const arrangeBattle = async () => {
    if (!pickA || !pickB) {
      Alert.alert('Pick two members', 'Choose both members to battle.');
      return;
    }
    if (pickA.uid === pickB.uid) {
      Alert.alert('Pick two different members', 'A member can’t battle themselves.');
      return;
    }
    setCreatingBattle(true);
    try {
      await createTeamBattle(teamId, user || { uid }, pickA, pickB, {});
      setBattleOpen(false);
      setPickA(null);
      setPickB(null);
      Alert.alert('Battle arranged', `${pickA.displayName} vs ${pickB.displayName}. Both have been notified.`);
    } catch (e) {
      Alert.alert('Could not arrange battle', e?.message || 'Please try again.');
    } finally {
      setCreatingBattle(false);
    }
  };

  const renderHeader = () => (
    <View style={styles.topRow}>
      <TouchableOpacity style={styles.backBtn} onPress={() => navigation?.goBack?.()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
        <Ionicons name="chevron-back" size={24} color={COLORS.textPrimary} />
      </TouchableOpacity>
      <Text style={styles.title}>My Team</Text>
      <View style={styles.backBtn} />
    </View>
  );

  if (loading) {
    return (
      <ScreenContainer>
        {renderHeader()}
        <View style={styles.center}><ActivityIndicator color={COLORS.primary} /></View>
      </ScreenContainer>
    );
  }

  if (!membership) {
    return (
      <ScreenContainer>
        {renderHeader()}
        <View style={styles.center}>
          <Ionicons name="people-outline" size={48} color={COLORS.textMuted} />
          <Text style={styles.emptyTitle}>You’re not in a team yet</Text>
          <Text style={styles.emptyText}>Browse the Teams page to find one to join, or apply to run your own.</Text>
        </View>
      </ScreenContainer>
    );
  }

  const team = { ...(membership.team || {}), ...(liveTeam || {}) };
  const memberPickList = members.filter((m) => m.role !== TEAM_ROLE.LEADER);

  // Leaderboard: everyone who has earned, highest first.
  const leaderboard = [...members]
    .map((m) => ({ ...m, _total: memberTotalEarned(m) }))
    .sort((a, b) => b._total - a._total);
  const topEarners = leaderboard.filter((m) => m._total > 0);

  const teamTotalGems = Number(team.teamTotalGems || 0);
  const leaderCutGems = Number(team.leaderBonusGems || 0);
  const myEarning = members.find((m) => m.uid === uid);
  const myTotal = memberTotalEarned(myEarning);
  const myBonus = Number(myEarning?.teamBonusGems || 0);

  return (
    <ScreenContainer>
      {renderHeader()}
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.teamHeader}>
          <BlypAvatar uri={team.leaderPhoto} name={team.leaderName} size={56} showBadge={false} />
          <View style={{ flex: 1 }}>
            <Text style={styles.teamName}>{team.name}</Text>
            <Text style={styles.teamMeta}>{isLeader ? 'You are the team leader' : `Led by ${team.leaderName || 'Leader'}`} · {members.length} members</Text>
          </View>
        </View>

        {isLeader && (
          <View style={styles.leaderActions}>
            <TouchableOpacity style={[styles.actionBtn, styles.actionPrimary]} activeOpacity={0.9} onPress={() => setMsgOpen(true)}>
              <Ionicons name="megaphone-outline" size={18} color="#001b18" />
              <Text style={styles.actionPrimaryText}>Group message</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionBtn, styles.actionGhost]} activeOpacity={0.9} onPress={() => setBattleOpen(true)}>
              <Ionicons name="flash-outline" size={18} color={COLORS.primary} />
              <Text style={styles.actionGhostText}>Arrange battle</Text>
            </TouchableOpacity>
          </View>
        )}

        {isLeader && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Team earnings</Text>
            <View style={styles.earnCards}>
              <View style={styles.earnCard}>
                <Ionicons name="diamond-outline" size={18} color={COLORS.primary} />
                <Text style={styles.earnValue}>{fmtGems(teamTotalGems)}</Text>
                <Text style={styles.earnCaption}>Gems earned by your team</Text>
              </View>
              <View style={styles.earnCard}>
                <Ionicons name="trophy-outline" size={18} color={COLORS.primary} />
                <Text style={styles.earnValue}>{fmtGems(leaderCutGems)}</Text>
                <Text style={styles.earnCaption}>Your leader cut (5%)</Text>
              </View>
            </View>
            <Text style={styles.earnHint}>
              Members earn +10% on every gift; you earn 5% of what each member makes.
            </Text>
          </View>
        )}

        {isLeader && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Leaderboard</Text>
            {topEarners.length === 0 ? (
              <Text style={styles.emptyText}>No earnings yet. They’ll appear here as members receive gifts.</Text>
            ) : (
              topEarners.map((m, i) => (
                <View key={m.uid} style={styles.lbRow}>
                  <Text style={[styles.lbRank, i < 3 && styles.lbRankTop]}>{i + 1}</Text>
                  <BlypAvatar uri={m.photoURL} name={m.displayName} size={36} showBadge={false} />
                  <View style={styles.memberBody}>
                    <Text style={styles.memberName} numberOfLines={1}>
                      {m.displayName || 'Member'}{m.uid === uid ? ' (you)' : ''}
                    </Text>
                    <Text style={styles.memberRole}>+{fmtGems(m.teamBonusGems)} bonus gems</Text>
                  </View>
                  <View style={styles.lbGemPill}>
                    <Ionicons name="diamond" size={12} color={COLORS.primary} />
                    <Text style={styles.lbGemText}>{fmtGems(m._total)}</Text>
                  </View>
                </View>
              ))
            )}
          </View>
        )}

        {!isLeader && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Your earnings</Text>
            <View style={styles.earnCards}>
              <View style={styles.earnCard}>
                <Ionicons name="diamond-outline" size={18} color={COLORS.primary} />
                <Text style={styles.earnValue}>{fmtGems(myTotal)}</Text>
                <Text style={styles.earnCaption}>Total gems earned</Text>
              </View>
              <View style={styles.earnCard}>
                <Ionicons name="gift-outline" size={18} color={COLORS.primary} />
                <Text style={styles.earnValue}>+{fmtGems(myBonus)}</Text>
                <Text style={styles.earnCaption}>Team bonus (+10%)</Text>
              </View>
            </View>
            <Text style={styles.earnHint}>Being on a team earns you an extra 10% on every gift you receive.</Text>
            <TouchableOpacity
              style={[styles.actionBtn, styles.actionGhost, { marginTop: 12 }]}
              activeOpacity={0.9}
              onPress={async () => {
                Alert.alert('Leave team?', `Leave ${team.name}?`, [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Leave',
                    style: 'destructive',
                    onPress: async () => {
                      try {
                        await leaveTeam(teamId, uid);
                        navigation?.goBack?.();
                      } catch (e) {
                        Alert.alert('Could not leave', e?.message || 'Please try again.');
                      }
                    },
                  },
                ]);
              }}
            >
              <Ionicons name="exit-outline" size={18} color="#f87171" />
              <Text style={[styles.actionGhostText, { color: '#f87171' }]}>Leave team</Text>
            </TouchableOpacity>
          </View>
        )}

        {isLeader && auditions.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Auditions</Text>
            {auditions.map((a) => {
              const candidates = [{ uid: a.aUid, name: a.aName, photo: a.aPhoto }];
              if (a.bUid && !a.bIsFallback) candidates.push({ uid: a.bUid, name: a.bName, photo: a.bPhoto });
              const r = a.results || null;
              const statusText =
                a.status === AUDITION_STATUS.AWAITING ? 'Finding an opponent\u2026'
                : a.status === AUDITION_STATUS.MATCHED ? 'Battle set \u2014 awaiting results'
                : a.status === AUDITION_STATUS.COMPLETED ? 'Completed \u2014 review below'
                : a.status === AUDITION_STATUS.EXPIRED ? 'Expired (no opponent)'
                : a.status;
              return (
                <View key={a.id} style={styles.audCard}>
                  <View style={styles.audHeadRow}>
                    <Ionicons name="mic" size={15} color={COLORS.primary} />
                    <Text style={styles.audVs} numberOfLines={1}>
                      {a.aName || 'Applicant'} vs {a.bName || (a.status === AUDITION_STATUS.AWAITING ? 'TBD' : 'Opponent')}
                      {a.bIsFallback ? ` (${a.fallbackRole === 'leader' ? 'leader' : 'fallback'})` : ''}
                    </Text>
                  </View>
                  <Text style={styles.audStatus}>{statusText}</Text>

                  {r && (
                    <View style={styles.audScoreRow}>
                      <View style={styles.audScoreBox}>
                        <Text style={styles.audScoreName} numberOfLines={1}>{a.aName || 'A'}</Text>
                        <Text style={[styles.audScoreVal, r.winnerSide === 'a' && styles.audScoreWin]}>{r.scoreA}</Text>
                      </View>
                      <Text style={styles.audScoreDash}>vs</Text>
                      <View style={styles.audScoreBox}>
                        <Text style={styles.audScoreName} numberOfLines={1}>{a.bName || 'B'}</Text>
                        <Text style={[styles.audScoreVal, r.winnerSide === 'b' && styles.audScoreWin]}>{r.scoreB}</Text>
                      </View>
                    </View>
                  )}

                  {a.status === AUDITION_STATUS.COMPLETED && candidates.map((c) => {
                    const dec = a.decisions?.[c.uid];
                    if (dec) {
                      return (
                        <View key={c.uid} style={styles.audDecidedRow}>
                          <Text style={styles.memberName} numberOfLines={1}>{c.name || 'Applicant'}</Text>
                          <Text style={[styles.audDecidedText, dec === 'accepted' ? styles.audAccepted : styles.audDeclined]}>
                            {dec === 'accepted' ? 'Accepted' : 'Declined'}
                          </Text>
                        </View>
                      );
                    }
                    return (
                      <View key={c.uid} style={styles.audDecideRow}>
                        <Text style={styles.memberName} numberOfLines={1}>{c.name || 'Applicant'}</Text>
                        <View style={styles.audBtns}>
                          <TouchableOpacity style={styles.acceptBtn} onPress={() => onAuditionDecision(a.id, c.uid, 'accepted')}>
                            <Ionicons name="checkmark" size={18} color="#001b18" />
                          </TouchableOpacity>
                          <TouchableOpacity style={styles.declineBtn} onPress={() => onAuditionDecision(a.id, c.uid, 'declined')}>
                            <Ionicons name="close" size={18} color={COLORS.error} />
                          </TouchableOpacity>
                        </View>
                      </View>
                    );
                  })}
                </View>
              );
            })}
          </View>
        )}

        {isLeader && requests.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Join requests ({requests.length})</Text>
            {requests.map((r) => (
              <View key={r.uid} style={styles.requestRow}>
                <BlypAvatar uri={r.photoURL} name={r.displayName} size={40} showBadge={false} />
                <View style={styles.memberBody}>
                  <Text style={styles.memberName}>{r.displayName || 'Member'}</Text>
                  {!!r.message && <Text style={styles.memberRole} numberOfLines={2}>{r.message}</Text>}
                </View>
                <TouchableOpacity style={styles.acceptBtn} onPress={() => onAccept(r)}>
                  <Ionicons name="checkmark" size={18} color="#001b18" />
                </TouchableOpacity>
                <TouchableOpacity style={styles.declineBtn} onPress={() => onDecline(r)}>
                  <Ionicons name="close" size={18} color={COLORS.error} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{isLeader ? 'Roster & live hours' : 'Members'}</Text>
          {members.map((m) => (
            <View key={m.uid} style={styles.memberRow}>
              <BlypAvatar uri={m.photoURL} name={m.displayName} size={40} showBadge={false} />
              <View style={styles.memberBody}>
                <Text style={styles.memberName}>{m.displayName || 'Member'}{m.uid === uid ? ' (you)' : ''}</Text>
                <Text style={styles.memberRole}>{m.role === TEAM_ROLE.LEADER ? 'Team leader' : 'Member'}</Text>
              </View>
              <View style={styles.statPill}>
                <Ionicons name="videocam-outline" size={14} color={COLORS.primary} />
                <Text style={styles.statText}>{fmtHours(m.hoursLive)} live</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Battles</Text>
          {battles.length === 0 ? (
            <Text style={styles.emptyText}>No battles arranged yet.</Text>
          ) : (
            battles.map((b) => (
              <View key={b.id} style={styles.battleRow}>
                <Ionicons name="flash" size={16} color={COLORS.primary} />
                <Text style={styles.battleText}>{b.aName} vs {b.bName}</Text>
                <Text style={styles.battleStatus}>{b.status || 'scheduled'}</Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>

      {/* Group message modal */}
      <Modal visible={msgOpen} transparent animationType="fade" onRequestClose={() => setMsgOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Message the team</Text>
            <Text style={styles.modalSub}>Every member gets this as a notification.</Text>
            <TextInput
              style={styles.modalInput}
              value={msgText}
              onChangeText={setMsgText}
              placeholder="Write a message…"
              placeholderTextColor={COLORS.textMuted}
              multiline
              maxLength={1000}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setMsgOpen(false)} disabled={sending}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalConfirm} onPress={sendGroupMessage} disabled={sending}>
                {sending ? <ActivityIndicator color="#001b18" /> : <Text style={styles.modalConfirmText}>Send</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Arrange battle modal */}
      <Modal visible={battleOpen} transparent animationType="fade" onRequestClose={() => setBattleOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Arrange a battle</Text>
            <Text style={styles.modalSub}>Pick two members to go head-to-head. Both will be notified.</Text>

            <Text style={styles.pickLabel}>First member</Text>
            <ScrollView style={styles.pickList} nestedScrollEnabled>
              {memberPickList.map((m) => (
                <TouchableOpacity
                  key={`a-${m.uid}`}
                  style={[styles.pickRow, pickA?.uid === m.uid && styles.pickRowOn]}
                  onPress={() => setPickA(m)}
                >
                  <Text style={[styles.pickText, pickA?.uid === m.uid && styles.pickTextOn]}>{m.displayName || 'Member'}</Text>
                  {pickA?.uid === m.uid && <Ionicons name="checkmark-circle" size={18} color={COLORS.primary} />}
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={styles.pickLabel}>Second member</Text>
            <ScrollView style={styles.pickList} nestedScrollEnabled>
              {memberPickList.map((m) => (
                <TouchableOpacity
                  key={`b-${m.uid}`}
                  style={[styles.pickRow, pickB?.uid === m.uid && styles.pickRowOn]}
                  onPress={() => setPickB(m)}
                >
                  <Text style={[styles.pickText, pickB?.uid === m.uid && styles.pickTextOn]}>{m.displayName || 'Member'}</Text>
                  {pickB?.uid === m.uid && <Ionicons name="checkmark-circle" size={18} color={COLORS.primary} />}
                </TouchableOpacity>
              ))}
            </ScrollView>

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setBattleOpen(false)} disabled={creatingBattle}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalConfirm} onPress={arrangeBattle} disabled={creatingBattle}>
                {creatingBattle ? <ActivityIndicator color="#001b18" /> : <Text style={styles.modalConfirmText}>Arrange</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 8 },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', color: COLORS.textPrimary, fontSize: 18, fontWeight: '800' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  emptyTitle: { color: COLORS.textPrimary, fontSize: 18, fontWeight: '800' },
  emptyText: { color: COLORS.textMuted, fontSize: 13, textAlign: 'center', lineHeight: 19 },
  scroll: { padding: 16, paddingBottom: 120 },
  teamHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18 },
  teamName: { color: COLORS.textPrimary, fontSize: 20, fontWeight: '800' },
  teamMeta: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  leaderActions: { flexDirection: 'row', gap: 10, marginBottom: 22 },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: 12 },
  actionPrimary: { backgroundColor: COLORS.primary },
  actionPrimaryText: { color: '#001b18', fontWeight: '800', fontSize: 14 },
  actionGhost: { borderWidth: 1, borderColor: COLORS.primary },
  actionGhostText: { color: COLORS.primary, fontWeight: '700', fontSize: 13 },
  section: { marginBottom: 24 },
  sectionLabel: { color: COLORS.textMuted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  requestRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  memberBody: { flex: 1 },
  memberName: { color: COLORS.textPrimary, fontSize: 15, fontWeight: '700' },
  memberRole: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  statPill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: COLORS.backgroundCard, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20 },
  statText: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '700' },
  acceptBtn: { backgroundColor: COLORS.primary, width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  declineBtn: { borderWidth: 1, borderColor: COLORS.error, width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  earnCards: { flexDirection: 'row', gap: 10 },
  earnCard: { flex: 1, backgroundColor: COLORS.backgroundCard, borderRadius: 14, padding: 14, alignItems: 'flex-start', gap: 6, borderWidth: 1, borderColor: COLORS.border },
  earnValue: { color: COLORS.textPrimary, fontSize: 22, fontWeight: '800' },
  earnCaption: { color: COLORS.textMuted, fontSize: 11, lineHeight: 15 },
  earnHint: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, marginTop: 10 },
  lbRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  lbRank: { width: 22, textAlign: 'center', color: COLORS.textMuted, fontSize: 14, fontWeight: '800' },
  lbRankTop: { color: COLORS.primary },
  lbGemPill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: COLORS.backgroundCard, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20 },
  lbGemText: { color: COLORS.textPrimary, fontSize: 13, fontWeight: '800' },
  battleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  audCard: { backgroundColor: COLORS.backgroundCard, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: COLORS.border },
  audHeadRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  audVs: { flex: 1, color: COLORS.textPrimary, fontSize: 15, fontWeight: '800' },
  audStatus: { color: COLORS.textMuted, fontSize: 12, marginTop: 3 },
  audScoreRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14, marginTop: 12, marginBottom: 4 },
  audScoreBox: { alignItems: 'center', flex: 1 },
  audScoreName: { color: COLORS.textSecondary, fontSize: 12, marginBottom: 2 },
  audScoreVal: { color: COLORS.textPrimary, fontSize: 24, fontWeight: '800' },
  audScoreWin: { color: COLORS.primary },
  audScoreDash: { color: COLORS.textMuted, fontSize: 13, fontWeight: '700' },
  audDecideRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingTop: 10, marginTop: 8, borderTopWidth: 1, borderTopColor: COLORS.border },
  audBtns: { flexDirection: 'row', gap: 8 },
  audDecidedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 10, marginTop: 8, borderTopWidth: 1, borderTopColor: COLORS.border },
  audDecidedText: { fontSize: 13, fontWeight: '800' },
  audAccepted: { color: COLORS.success },
  audDeclined: { color: COLORS.error },
  battleText: { flex: 1, color: COLORS.textPrimary, fontSize: 14, fontWeight: '600' },
  battleStatus: { color: COLORS.textMuted, fontSize: 12, textTransform: 'capitalize' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 24 },
  modalCard: { backgroundColor: COLORS.surface, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: COLORS.border },
  modalTitle: { color: COLORS.textPrimary, fontSize: 18, fontWeight: '800' },
  modalSub: { color: COLORS.textSecondary, fontSize: 13, marginTop: 6, lineHeight: 19 },
  modalInput: { marginTop: 14, minHeight: 96, backgroundColor: COLORS.backgroundCard, borderRadius: 12, padding: 12, color: COLORS.textPrimary, textAlignVertical: 'top', borderWidth: 1, borderColor: COLORS.border },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 16 },
  modalCancel: { paddingVertical: 10, paddingHorizontal: 16 },
  modalCancelText: { color: COLORS.textSecondary, fontWeight: '700' },
  modalConfirm: { backgroundColor: COLORS.primary, paddingVertical: 10, paddingHorizontal: 18, borderRadius: 10 },
  modalConfirmText: { color: '#001b18', fontWeight: '800' },
  pickLabel: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '700', marginTop: 14, marginBottom: 6 },
  pickList: { maxHeight: 120, backgroundColor: COLORS.backgroundCard, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border },
  pickRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, paddingHorizontal: 12 },
  pickRowOn: { backgroundColor: 'rgba(0,210,190,0.08)' },
  pickText: { color: COLORS.textPrimary, fontSize: 14 },
  pickTextOn: { color: COLORS.primary, fontWeight: '700' },
});

export default MyTeamScreen;
