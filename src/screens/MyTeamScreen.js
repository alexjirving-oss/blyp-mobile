// MyTeamScreen — Team dashboard (leader + member).
// Identity hero, honest stats chrome, roster with presence, message / battle /
// invite CTAs. Empty teams still show the full dashboard shell.

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
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
  Animated,
  Easing,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import ScreenContainer from '../components/ScreenContainer';
import BlypAvatar from '../components/BlypAvatar';
import PressableLift from '../components/motion/PressableLift';
import { COLORS } from '../styles/theme';
import { useAuth } from '../hooks/useCommon';
import { shareTeam } from '../services/shareService';
import {
  getMyMembership,
  subscribeTeam,
  subscribeTeamMembers,
  subscribeJoinRequests,
  subscribeTeamBattles,
  subscribeAuditions,
  subscribeMembersPresence,
  subscribeTeamMessages,
  computeTeamDashboardStats,
  acceptJoinRequest,
  declineJoinRequest,
  decideAudition,
  sendTeamGroupMessage,
  createTeamBattle,
  leaveTeam,
  removeTeamMember,
  closeTeam,
  setTeamMemberRestricted,
  warnTeamMember,
  TEAM_ROLE,
  AUDITION_STATUS,
} from '../services/teamsService';

const fmtHours = (h) => {
  const n = Number(h || 0);
  if (n <= 0) return '0h';
  if (n < 1) return `${Math.round(n * 60)}m`;
  return `${n.toFixed(n < 10 ? 1 : 0)}h`;
};

const fmtGems = (g) => {
  const n = Number(g || 0);
  if (!Number.isFinite(n) || n <= 0) return '0';
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
};

const memberTotalEarned = (m) =>
  Number(m?.gemsEarned || 0) + Number(m?.teamBonusGems || 0);

const roleLabel = (role, isLeaderUid, uid) => {
  if (isLeaderUid || role === TEAM_ROLE.LEADER) return 'Owner';
  if (role === 'admin') return 'Admin';
  return 'Member';
};

function StatCell({ value, label }) {
  return (
    <View style={styles.statCell}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statCaption}>{label}</Text>
    </View>
  );
}

function ActionChip({ icon, label, onPress, primary, danger }) {
  return (
    <PressableLift
      onPress={onPress}
      style={[
        styles.actionChip,
        primary && styles.actionChipPrimary,
        danger && styles.actionChipDanger,
      ]}
      contentStyle={styles.actionChipInner}
    >
      <Ionicons
        name={icon}
        size={18}
        color={primary ? '#001b18' : danger ? '#f87171' : COLORS.primary}
      />
      <Text
        style={[
          styles.actionChipText,
          primary && styles.actionChipTextPrimary,
          danger && styles.actionChipTextDanger,
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </PressableLift>
  );
}

const MyTeamScreen = ({ navigation }) => {
  const { user, uid } = useAuth();
  const [loading, setLoading] = useState(true);
  const [membership, setMembership] = useState(null);
  const [liveTeam, setLiveTeam] = useState(null);
  const [members, setMembers] = useState([]);
  const [requests, setRequests] = useState([]);
  const [battles, setBattles] = useState([]);
  const [auditions, setAuditions] = useState([]);
  const [presence, setPresence] = useState({});
  const [messages, setMessages] = useState([]);

  const [msgOpen, setMsgOpen] = useState(false);
  const [msgText, setMsgText] = useState('');
  const [sending, setSending] = useState(false);
  const [warningMember, setWarningMember] = useState(null);
  const [warningText, setWarningText] = useState('');
  const [memberActionBusy, setMemberActionBusy] = useState(false);

  const [battleOpen, setBattleOpen] = useState(false);
  const [pickA, setPickA] = useState(null);
  const [pickB, setPickB] = useState(null);
  const [creatingBattle, setCreatingBattle] = useState(false);

  const glow = useRef(new Animated.Value(0)).current;
  const enter = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 2400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0, duration: 2400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    loop.start();
    Animated.timing(enter, { toValue: 1, duration: 520, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    return () => loop.stop();
  }, [glow, enter]);

  const loadMembership = useCallback(async () => {
    if (!uid) {
      setLoading(false);
      return;
    }
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
    const unsubMessages = subscribeTeamMessages(teamId, setMessages);
    const unsubR = isLeader ? subscribeJoinRequests(teamId, setRequests) : null;
    const unsubA = isLeader ? subscribeAuditions(teamId, setAuditions) : null;
    return () => {
      try { unsubT && unsubT(); } catch {}
      try { unsubM && unsubM(); } catch {}
      try { unsubB && unsubB(); } catch {}
      try { unsubMessages && unsubMessages(); } catch {}
      try { unsubR && unsubR(); } catch {}
      try { unsubA && unsubA(); } catch {}
    };
  }, [teamId, isLeader]);

  const memberUids = useMemo(() => members.map((m) => m.uid).filter(Boolean), [members]);

  useEffect(() => {
    if (!memberUids.length) {
      setPresence({});
      return undefined;
    }
    return subscribeMembersPresence(memberUids, setPresence);
  }, [memberUids.join('|')]);

  const myMember = members.find((member) => member.uid === uid) || membership?.member || null;
  const myPostingRestricted = !isLeader && !!myMember?.restricted;

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
    if (myPostingRestricted) {
      Alert.alert(
        'Posting restricted',
        'The team owner has restricted you from posting. You can still read team messages.'
      );
      return;
    }
    setSending(true);
    try {
      await sendTeamGroupMessage(teamId, { ...(user || {}), uid }, msgText.trim());
      setMsgText('');
    } catch (e) {
      Alert.alert('Could not send', e?.message || 'Please try again.');
    } finally {
      setSending(false);
    }
  };

  const onRemoveMember = (member) => {
    const label = member?.displayName || 'this member';
    Alert.alert(
      `Remove ${label}?`,
      'They will immediately lose team membership and team-chat access.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setMemberActionBusy(true);
            try {
              await removeTeamMember(teamId, member.uid);
            } catch (e) {
              Alert.alert('Could not remove member', e?.message || 'Please try again.');
            } finally {
              setMemberActionBusy(false);
            }
          },
        },
      ]
    );
  };

  const onToggleRestriction = (member) => {
    const nextRestricted = !member?.restricted;
    const label = member?.displayName || 'this member';
    Alert.alert(
      nextRestricted ? `Restrict ${label}?` : `Lift restriction for ${label}?`,
      nextRestricted
        ? 'They can still read team messages, but cannot post until you lift the restriction.'
        : 'They will be able to post in team chat again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: nextRestricted ? 'Restrict' : 'Lift restriction',
          onPress: async () => {
            setMemberActionBusy(true);
            try {
              await setTeamMemberRestricted(teamId, uid, member.uid, nextRestricted);
            } catch (e) {
              Alert.alert('Could not update restriction', e?.message || 'Please try again.');
            } finally {
              setMemberActionBusy(false);
            }
          },
        },
      ]
    );
  };

  const submitWarning = async () => {
    if (!warningMember || !warningText.trim()) return;
    setMemberActionBusy(true);
    try {
      await warnTeamMember(
        teamId,
        { ...(user || {}), uid },
        warningMember,
        warningText.trim()
      );
      setWarningMember(null);
      setWarningText('');
    } catch (e) {
      Alert.alert('Could not send warning', e?.message || 'Please try again.');
    } finally {
      setMemberActionBusy(false);
    }
  };

  const onCloseTeam = () => {
    const teamName = liveTeam?.name || membership?.team?.name || 'this team';
    Alert.alert(
      `Close ${teamName}?`,
      'This removes the team from discovery and ends every membership. Message history is kept for audit purposes.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Close team',
          style: 'destructive',
          onPress: async () => {
            setMemberActionBusy(true);
            try {
              await closeTeam(teamId, uid);
              setMembership(null);
              navigation?.goBack?.();
            } catch (e) {
              Alert.alert('Could not close team', e?.message || 'Please try again.');
            } finally {
              setMemberActionBusy(false);
            }
          },
        },
      ]
    );
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

  const openSetupBattle = () => {
    const team = { ...(membership?.team || {}), ...(liveTeam || {}) };
    const roster = members.map((m) => ({
      id: m.uid,
      uid: m.uid,
      displayName: m.displayName || 'Member',
      photoURL: m.photoURL || null,
      username: m.username || '',
    }));
    if (isLeader && roster.filter((m) => m.uid !== uid).length >= 2) {
      Alert.alert('Set up a battle', 'Challenge someone publicly, or arrange an internal team battle.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Internal (roster)',
          onPress: () => setBattleOpen(true),
        },
        {
          text: 'Prearrange',
          onPress: () =>
            navigation?.navigate?.('CreateBattle', {
              teamId,
              teamName: team.name,
              teamMembers: roster.filter((m) => m.uid !== uid),
              prefillTitle: team.name ? `${team.name} battle` : undefined,
            }),
        },
      ]);
      return;
    }
    navigation?.navigate?.('CreateBattle', {
      teamId,
      teamName: team.name,
      teamMembers: roster.filter((m) => m.uid !== uid),
      prefillTitle: team.name ? `${team.name} battle` : undefined,
    });
  };

  const onInvite = async () => {
    const team = { ...(membership?.team || {}), ...(liveTeam || {}), id: teamId };
    const ok = await shareTeam(team);
    if (!ok) Alert.alert('Share unavailable', 'Could not open the share sheet right now.');
  };

  const openMember = (m) => {
    if (!m?.uid) return;
    navigation?.navigate?.('UserProfile', {
      userId: String(m.uid),
      username: m.displayName || m.username || '@user',
    });
  };

  const renderHeader = () => (
    <View style={styles.topRow}>
      <TouchableOpacity style={styles.backBtn} onPress={() => navigation?.goBack?.()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
        <Ionicons name="chevron-back" size={24} color={COLORS.textPrimary} />
      </TouchableOpacity>
      <Text style={styles.title}>Team</Text>
      <TouchableOpacity style={styles.backBtn} onPress={onInvite} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
        <Ionicons name="share-outline" size={22} color={COLORS.primary} />
      </TouchableOpacity>
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
        <View style={styles.emptyShell}>
          <LinearGradient
            colors={['rgba(0,210,190,0.18)', 'transparent']}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={styles.emptyGlow}
          />
          <Ionicons name="people-outline" size={52} color={COLORS.primary} />
          <Text style={styles.emptyTitle}>No team yet</Text>
          <Text style={styles.emptyText}>
            Browse Teams to join a crew, or apply to run your own. Your dashboard will light up once you’re in.
          </Text>
          <PressableLift
            style={styles.emptyCta}
            contentStyle={styles.emptyCtaInner}
            onPress={() => {
              try {
                navigation?.navigate?.('Chat', { initialTab: 'teams' });
              } catch {
                navigation?.goBack?.();
              }
            }}
          >
            <Text style={styles.emptyCtaText}>Browse teams</Text>
          </PressableLift>
        </View>
      </ScreenContainer>
    );
  }

  const team = { ...(membership.team || {}), ...(liveTeam || {}) };
  const memberPickList = members.filter((m) => m.role !== TEAM_ROLE.LEADER);
  const stats = computeTeamDashboardStats({ team, members, battles });
  const crestUri = team.crestUrl || team.avatarUrl || team.photoURL || team.leaderPhoto;

  const leaderboard = [...members]
    .map((m) => ({ ...m, _total: memberTotalEarned(m) }))
    .sort((a, b) => b._total - a._total);
  const topEarners = leaderboard.filter((m) => m._total > 0);

  const teamTotalGems = Number(team.teamTotalGems || 0);
  const leaderCutGems = Number(team.leaderBonusGems || 0);
  const myEarning = members.find((m) => m.uid === uid);
  const myTotal = memberTotalEarned(myEarning);
  const myBonus = Number(myEarning?.teamBonusGems || 0);

  const glowOpacity = glow.interpolate({ inputRange: [0, 1], outputRange: [0.22, 0.48] });
  const enterY = enter.interpolate({ inputRange: [0, 1], outputRange: [18, 0] });

  return (
    <ScreenContainer>
      {renderHeader()}
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Animated.View style={{ opacity: enter, transform: [{ translateY: enterY }] }}>
          <View style={styles.hero}>
            <Animated.View style={[styles.heroAura, { opacity: glowOpacity }]} pointerEvents="none">
              <LinearGradient
                colors={['rgba(0,210,190,0.35)', 'rgba(0,168,158,0.08)', 'transparent']}
                style={StyleSheet.absoluteFill}
              />
            </Animated.View>
            <View style={styles.heroIdentity}>
              <BlypAvatar uri={crestUri} name={team.name || team.leaderName} size={72} showBadge={false} />
              <View style={styles.heroCopy}>
                <Text style={styles.teamName} numberOfLines={2}>{team.name || 'Your team'}</Text>
                <Text style={styles.teamMeta} numberOfLines={2}>
                  {isLeader ? 'You lead this team' : `Led by ${team.leaderName || 'Leader'}`}
                  {' · '}
                  {stats.memberCount} {stats.memberCount === 1 ? 'member' : 'members'}
                </Text>
                {!!stats.tier && (
                  <View style={styles.tierPill}>
                    <Ionicons name="ribbon-outline" size={12} color={COLORS.primary} />
                    <Text style={styles.tierText}>{stats.tier}</Text>
                  </View>
                )}
              </View>
            </View>

            <View style={styles.statsStrip}>
              <StatCell value={stats.winsLabel} label="Wins" />
              <View style={styles.statDivider} />
              <StatCell value={stats.battlesLabel} label="Battles" />
              <View style={styles.statDivider} />
              <StatCell value={stats.giftsLabel} label="Gifts" />
              <View style={styles.statDivider} />
              <StatCell value={stats.activeLabel} label="Active" />
              <View style={styles.statDivider} />
              <StatCell value={stats.weeklyLabel} label="Weekly" />
            </View>
            <Text style={styles.statsHint}>
              {stats.memberCount <= 1
                ? 'Stats fill in as members join, go live, and battle.'
                : 'Live from your roster — empty fields stay as — until data exists.'}
            </Text>
          </View>

          <View style={styles.actionsRow}>
            <ActionChip icon="chatbubbles-outline" label="Message" onPress={() => setMsgOpen(true)} primary />
            <ActionChip icon="flash-outline" label="Set up battle" onPress={openSetupBattle} />
            <ActionChip icon="person-add-outline" label="Invite" onPress={onInvite} />
          </View>

          {isLeader && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Team earnings</Text>
              <View style={styles.earnRow}>
                <View style={styles.earnBlock}>
                  <Text style={styles.earnValue}>{fmtGems(teamTotalGems) === '0' ? '—' : fmtGems(teamTotalGems)}</Text>
                  <Text style={styles.earnCaption}>Team gems</Text>
                </View>
                <View style={styles.earnBlock}>
                  <Text style={styles.earnValue}>{fmtGems(leaderCutGems) === '0' ? '—' : fmtGems(leaderCutGems)}</Text>
                  <Text style={styles.earnCaption}>Your leader cut</Text>
                </View>
              </View>
            </View>
          )}

          {isLeader && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Top earners</Text>
              {topEarners.length === 0 ? (
                <Text style={styles.sectionEmpty}>No earnings yet — they’ll appear as members receive gifts.</Text>
              ) : (
                topEarners.slice(0, 5).map((m, i) => (
                  <TouchableOpacity key={m.uid} style={styles.lbRow} onPress={() => openMember(m)} activeOpacity={0.8}>
                    <Text style={[styles.lbRank, i < 3 && styles.lbRankTop]}>{i + 1}</Text>
                    <BlypAvatar uri={m.photoURL} name={m.displayName} size={36} showBadge={false} />
                    <View style={styles.memberBody}>
                      <Text style={styles.memberName} numberOfLines={1}>
                        {m.displayName || 'Member'}{m.uid === uid ? ' (you)' : ''}
                      </Text>
                      <Text style={styles.memberRole}>+{fmtGems(m.teamBonusGems)} bonus</Text>
                    </View>
                    <Text style={styles.lbGemText}>{fmtGems(m._total)}</Text>
                  </TouchableOpacity>
                ))
              )}
            </View>
          )}

          {!isLeader && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Your earnings</Text>
              <View style={styles.earnRow}>
                <View style={styles.earnBlock}>
                  <Text style={styles.earnValue}>{myTotal > 0 ? fmtGems(myTotal) : '—'}</Text>
                  <Text style={styles.earnCaption}>Total gems</Text>
                </View>
                <View style={styles.earnBlock}>
                  <Text style={styles.earnValue}>{myBonus > 0 ? `+${fmtGems(myBonus)}` : '—'}</Text>
                  <Text style={styles.earnCaption}>Team bonus</Text>
                </View>
              </View>
              <ActionChip
                icon="exit-outline"
                label="Leave team"
                danger
                onPress={() => {
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
              />
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
                  a.status === AUDITION_STATUS.AWAITING ? 'Finding an opponent…'
                  : a.status === AUDITION_STATUS.MATCHED ? 'Battle set — awaiting results'
                  : a.status === AUDITION_STATUS.COMPLETED ? 'Completed — review below'
                  : a.status === AUDITION_STATUS.EXPIRED ? 'Expired (no opponent)'
                  : a.status;
                return (
                  <View key={a.id} style={styles.audCard}>
                    <View style={styles.audHeadRow}>
                      <Ionicons name="mic" size={15} color={COLORS.primary} />
                      <Text style={styles.audVs} numberOfLines={1}>
                        {a.aName || 'Applicant'} vs {a.bName || (a.status === AUDITION_STATUS.AWAITING ? 'TBD' : 'Opponent')}
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
                  <TouchableOpacity onPress={() => openMember(r)} activeOpacity={0.8}>
                    <BlypAvatar uri={r.photoURL} name={r.displayName} size={40} showBadge={false} />
                  </TouchableOpacity>
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
            <Text style={styles.sectionLabel}>Roster</Text>
            {members.length === 0 ? (
              <View style={styles.rosterEmpty}>
                <Text style={styles.rosterEmptyTitle}>No members yet</Text>
                <Text style={styles.sectionEmpty}>Invite your first teammate to fill this roster.</Text>
                <ActionChip icon="person-add-outline" label="Invite" onPress={onInvite} primary />
              </View>
            ) : (
              members.map((m) => {
                const online = !!presence[m.uid];
                return (
                  <View key={m.uid} style={styles.memberRow}>
                    <TouchableOpacity
                      style={styles.memberMain}
                      onPress={() => openMember(m)}
                      activeOpacity={0.85}
                    >
                      <View>
                        <BlypAvatar uri={m.photoURL} name={m.displayName} size={44} showBadge={false} />
                        {online && <View style={styles.onlineDot} />}
                      </View>
                      <View style={styles.memberBody}>
                        <Text style={styles.memberName}>
                          {m.displayName || 'Member'}{m.uid === uid ? ' (you)' : ''}
                        </Text>
                        <Text style={styles.memberRole}>
                          {roleLabel(m.role, team.leaderId === m.uid, m.uid)}
                          {online ? ' · Online' : ''}
                          {m.restricted ? ' · Restricted' : ''}
                        </Text>
                      </View>
                      <View style={styles.statPill}>
                        <Ionicons name="videocam-outline" size={14} color={COLORS.primary} />
                        <Text style={styles.statText}>{fmtHours(m.hoursLive)}</Text>
                      </View>
                    </TouchableOpacity>
                    {isLeader && m.uid !== uid && m.uid !== team.leaderId && (
                      <View style={styles.memberControls}>
                        <TouchableOpacity
                          style={styles.memberControl}
                          onPress={() => {
                            setWarningMember(m);
                            setWarningText('');
                          }}
                          disabled={memberActionBusy}
                          accessibilityLabel={`Warn ${m.displayName || 'member'}`}
                        >
                          <Ionicons name="warning-outline" size={16} color="#fbbf24" />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.memberControl}
                          onPress={() => onToggleRestriction(m)}
                          disabled={memberActionBusy}
                          accessibilityLabel={
                            m.restricted
                              ? `Lift restriction for ${m.displayName || 'member'}`
                              : `Restrict ${m.displayName || 'member'}`
                          }
                        >
                          <Ionicons
                            name={m.restricted ? 'lock-open-outline' : 'lock-closed-outline'}
                            size={16}
                            color={COLORS.primary}
                          />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.memberControl, styles.memberControlDanger]}
                          onPress={() => onRemoveMember(m)}
                          disabled={memberActionBusy}
                          accessibilityLabel={`Remove ${m.displayName || 'member'}`}
                        >
                          <Ionicons name="person-remove-outline" size={16} color="#f87171" />
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                );
              })
            )}
          </View>

          {isLeader && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Owner controls</Text>
              <Text style={styles.sectionEmpty}>
                Warnings appear in team chat. Restricted members can read chat but cannot post.
              </Text>
              <ActionChip
                icon="trash-outline"
                label="Close team"
                danger
                onPress={onCloseTeam}
              />
            </View>
          )}

          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionLabel}>Battles</Text>
              <TouchableOpacity onPress={openSetupBattle}>
                <Text style={styles.sectionLink}>Set up</Text>
              </TouchableOpacity>
            </View>
            {battles.length === 0 ? (
              <Text style={styles.sectionEmpty}>No battles arranged yet — set one up when you’re ready.</Text>
            ) : (
              battles.slice(0, 8).map((b) => (
                <View key={b.id} style={styles.battleRow}>
                  <Ionicons name="flash" size={16} color={COLORS.primary} />
                  <Text style={styles.battleText}>{b.aName} vs {b.bName}</Text>
                  <Text style={styles.battleStatus}>{b.status || 'scheduled'}</Text>
                </View>
              ))
            )}
          </View>
        </Animated.View>
      </ScrollView>

      <Modal visible={msgOpen} transparent animationType="fade" onRequestClose={() => setMsgOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, styles.chatModalCard]}>
            <Text style={styles.modalTitle}>Team chat</Text>
            <Text style={styles.modalSub}>
              Messages stay with the team and notify the rest of the roster.
            </Text>
            <ScrollView
              style={styles.messageList}
              contentContainerStyle={styles.messageListContent}
              nestedScrollEnabled
            >
              {messages.length === 0 ? (
                <Text style={styles.sectionEmpty}>No messages yet. Start the team conversation.</Text>
              ) : (
                messages.map((message) => {
                  const mine = message.senderId === uid || message.uid === uid;
                  const warning = message.kind === 'warning';
                  return (
                    <View
                      key={message.id}
                      style={[
                        styles.messageBubble,
                        mine && styles.messageBubbleMine,
                        warning && styles.messageBubbleWarning,
                      ]}
                    >
                      <Text style={styles.messageAuthor} numberOfLines={1}>
                        {warning
                          ? `Warning for ${message.targetName || 'member'}`
                          : message.senderName || 'Team member'}
                      </Text>
                      <Text style={styles.messageText}>{message.text}</Text>
                    </View>
                  );
                })
              )}
            </ScrollView>
            {myPostingRestricted && (
              <View style={styles.restrictedNotice}>
                <Ionicons name="lock-closed-outline" size={15} color="#fbbf24" />
                <Text style={styles.restrictedNoticeText}>
                  The owner has restricted you from posting. You can still read messages.
                </Text>
              </View>
            )}
            <TextInput
              style={styles.modalInput}
              value={msgText}
              onChangeText={setMsgText}
              placeholder={myPostingRestricted ? 'Posting restricted' : 'Write a message…'}
              placeholderTextColor={COLORS.textMuted}
              multiline
              maxLength={1000}
              editable={!myPostingRestricted}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setMsgOpen(false)} disabled={sending}>
                <Text style={styles.modalCancelText}>Done</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalConfirm}
                onPress={sendGroupMessage}
                disabled={sending || myPostingRestricted || !msgText.trim()}
              >
                {sending ? <ActivityIndicator color="#001b18" /> : <Text style={styles.modalConfirmText}>Send</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={!!warningMember}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setWarningMember(null);
          setWarningText('');
        }}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              Warn {warningMember?.displayName || 'member'}
            </Text>
            <Text style={styles.modalSub}>
              This warning is recorded on their membership and posted in team chat.
            </Text>
            <TextInput
              style={styles.modalInput}
              value={warningText}
              onChangeText={setWarningText}
              placeholder="Explain what needs to change…"
              placeholderTextColor={COLORS.textMuted}
              multiline
              maxLength={280}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={() => {
                  setWarningMember(null);
                  setWarningText('');
                }}
                disabled={memberActionBusy}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalConfirm}
                onPress={submitWarning}
                disabled={memberActionBusy || !warningText.trim()}
              >
                {memberActionBusy
                  ? <ActivityIndicator color="#001b18" />
                  : <Text style={styles.modalConfirmText}>Send warning</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={battleOpen} transparent animationType="fade" onRequestClose={() => setBattleOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Arrange a battle</Text>
            <Text style={styles.modalSub}>Pick two members to go head-to-head. Both will be notified.</Text>
            {memberPickList.length < 2 ? (
              <Text style={styles.sectionEmpty}>Need at least two members on the roster (besides you) to arrange an internal battle.</Text>
            ) : (
              <>
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
              </>
            )}
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setBattleOpen(false)} disabled={creatingBattle}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalConfirm}
                onPress={arrangeBattle}
                disabled={creatingBattle || memberPickList.length < 2}
              >
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
  title: { flex: 1, textAlign: 'center', color: COLORS.textPrimary, fontSize: 18, fontWeight: '800', letterSpacing: 0.3 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  emptyShell: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  emptyGlow: { ...StyleSheet.absoluteFillObject, top: 0, height: 220 },
  emptyTitle: { color: COLORS.textPrimary, fontSize: 22, fontWeight: '800' },
  emptyText: { color: COLORS.textMuted, fontSize: 14, textAlign: 'center', lineHeight: 21 },
  emptyCta: { marginTop: 8, backgroundColor: COLORS.primary, borderRadius: 14, overflow: 'hidden' },
  emptyCtaInner: { paddingVertical: 12, paddingHorizontal: 22 },
  emptyCtaText: { color: '#001b18', fontWeight: '800', fontSize: 15 },
  scroll: { paddingBottom: 120 },
  hero: {
    marginHorizontal: 16,
    marginBottom: 18,
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: '#0E1214',
    borderWidth: 1,
    borderColor: 'rgba(0,210,190,0.22)',
    padding: 18,
  },
  heroAura: { ...StyleSheet.absoluteFillObject },
  heroIdentity: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  heroCopy: { flex: 1 },
  teamName: { color: COLORS.textPrimary, fontSize: 24, fontWeight: '900', letterSpacing: -0.3 },
  teamMeta: { color: COLORS.textSecondary, fontSize: 13, marginTop: 4, lineHeight: 18 },
  tierPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    backgroundColor: 'rgba(0,210,190,0.12)',
  },
  tierText: { color: COLORS.primary, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 },
  statsStrip: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginTop: 18,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  statCell: { flex: 1, alignItems: 'center', gap: 4 },
  statValue: { color: COLORS.textPrimary, fontSize: 17, fontWeight: '900' },
  statCaption: { color: COLORS.textMuted, fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  statDivider: { width: 1, backgroundColor: 'rgba(255,255,255,0.06)', marginVertical: 2 },
  statsHint: { color: COLORS.textMuted, fontSize: 11, marginTop: 12, lineHeight: 16 },
  actionsRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 22 },
  actionChip: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(0,210,190,0.35)',
    backgroundColor: 'rgba(0,210,190,0.06)',
    overflow: 'hidden',
  },
  actionChipPrimary: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  actionChipDanger: { borderColor: 'rgba(248,113,113,0.35)', backgroundColor: 'rgba(248,113,113,0.06)', marginTop: 12 },
  actionChipInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, paddingHorizontal: 6 },
  actionChipText: { color: COLORS.primary, fontWeight: '800', fontSize: 12 },
  actionChipTextPrimary: { color: '#001b18' },
  actionChipTextDanger: { color: '#f87171' },
  section: { paddingHorizontal: 16, marginBottom: 26 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sectionLabel: { color: COLORS.textMuted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 12 },
  sectionLink: { color: COLORS.primary, fontWeight: '800', fontSize: 13, marginBottom: 12 },
  sectionEmpty: { color: COLORS.textMuted, fontSize: 13, lineHeight: 19 },
  earnRow: { flexDirection: 'row', gap: 12 },
  earnBlock: { flex: 1 },
  earnValue: { color: COLORS.textPrimary, fontSize: 26, fontWeight: '900' },
  earnCaption: { color: COLORS.textMuted, fontSize: 12, marginTop: 4 },
  lbRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  lbRank: { width: 22, textAlign: 'center', color: COLORS.textMuted, fontSize: 14, fontWeight: '800' },
  lbRankTop: { color: COLORS.primary },
  lbGemText: { color: COLORS.textPrimary, fontSize: 13, fontWeight: '800' },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10 },
  memberMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  memberControls: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  memberControl: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(0,210,190,0.28)',
    backgroundColor: 'rgba(0,210,190,0.06)',
  },
  memberControlDanger: {
    borderColor: 'rgba(248,113,113,0.3)',
    backgroundColor: 'rgba(248,113,113,0.06)',
  },
  requestRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  memberBody: { flex: 1 },
  memberName: { color: COLORS.textPrimary, fontSize: 15, fontWeight: '700' },
  memberRole: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  onlineDot: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: COLORS.success,
    borderWidth: 2,
    borderColor: COLORS.pageBackground,
  },
  statPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,255,255,0.04)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
  },
  statText: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '700' },
  rosterEmpty: { gap: 8 },
  rosterEmptyTitle: { color: COLORS.textPrimary, fontSize: 16, fontWeight: '800' },
  acceptBtn: { backgroundColor: COLORS.primary, width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  declineBtn: { borderWidth: 1, borderColor: COLORS.error, width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  battleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  battleText: { flex: 1, color: COLORS.textPrimary, fontSize: 14, fontWeight: '600' },
  battleStatus: { color: COLORS.textMuted, fontSize: 12, textTransform: 'capitalize' },
  audCard: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  audHeadRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  audVs: { flex: 1, color: COLORS.textPrimary, fontSize: 15, fontWeight: '800' },
  audStatus: { color: COLORS.textMuted, fontSize: 12, marginTop: 3 },
  audScoreRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14, marginTop: 12, marginBottom: 4 },
  audScoreBox: { alignItems: 'center', flex: 1 },
  audScoreName: { color: COLORS.textSecondary, fontSize: 12, marginBottom: 2 },
  audScoreVal: { color: COLORS.textPrimary, fontSize: 24, fontWeight: '800' },
  audScoreWin: { color: COLORS.primary },
  audScoreDash: { color: COLORS.textMuted, fontSize: 13, fontWeight: '700' },
  audDecideRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingTop: 10,
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  audBtns: { flexDirection: 'row', gap: 8 },
  audDecidedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 10,
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  audDecidedText: { fontSize: 13, fontWeight: '800' },
  audAccepted: { color: COLORS.success },
  audDeclined: { color: COLORS.error },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 24 },
  modalCard: { backgroundColor: COLORS.surface, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: COLORS.border },
  chatModalCard: { maxHeight: '82%' },
  modalTitle: { color: COLORS.textPrimary, fontSize: 18, fontWeight: '800' },
  modalSub: { color: COLORS.textSecondary, fontSize: 13, marginTop: 6, lineHeight: 19 },
  messageList: {
    maxHeight: 270,
    marginTop: 14,
    borderRadius: 12,
    backgroundColor: COLORS.backgroundCard,
  },
  messageListContent: { padding: 10, gap: 8 },
  messageBubble: {
    alignSelf: 'flex-start',
    maxWidth: '88%',
    borderRadius: 12,
    paddingHorizontal: 11,
    paddingVertical: 9,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  messageBubbleMine: {
    alignSelf: 'flex-end',
    backgroundColor: 'rgba(0,210,190,0.12)',
    borderColor: 'rgba(0,210,190,0.3)',
  },
  messageBubbleWarning: {
    alignSelf: 'stretch',
    maxWidth: '100%',
    backgroundColor: 'rgba(251,191,36,0.08)',
    borderColor: 'rgba(251,191,36,0.35)',
  },
  messageAuthor: { color: COLORS.primary, fontSize: 11, fontWeight: '800', marginBottom: 3 },
  messageText: { color: COLORS.textPrimary, fontSize: 14, lineHeight: 19 },
  restrictedNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    padding: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(251,191,36,0.08)',
  },
  restrictedNoticeText: { flex: 1, color: '#fbbf24', fontSize: 12, lineHeight: 17 },
  modalInput: {
    marginTop: 14,
    minHeight: 96,
    backgroundColor: COLORS.backgroundCard,
    borderRadius: 12,
    padding: 12,
    color: COLORS.textPrimary,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
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
