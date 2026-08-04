// TeamDetailScreen — view a team and request to join it.

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ScreenContainer from '../components/ScreenContainer';
import BlypAvatar from '../components/BlypAvatar';
import { COLORS } from '../styles/theme';
import { useAuth } from '../hooks/useCommon';
import { doc, onSnapshot } from 'firebase/firestore';
import { firestore as db } from '../config/firebase';
import {
  subscribeTeam,
  subscribeTeamMembers,
  subscribeTeamBattles,
  subscribeAuditions,
  requestAudition,
  checkInAudition,
  getMyJoinRequest,
  requestToJoinTeam,
  getMyMembership,
  JOIN_STATUS,
  AUDITION_STATUS,
  AUDITION_CHECKIN_LEAD_MS,
} from '../services/teamsService';

// HH:MM:SS (or MM:SS) countdown formatter.
const fmtCountdown = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
};

// Format an instant as UK wall-clock time, computed deterministically (UTC+1 in
// summer/BST, else UTC). We avoid toLocaleTimeString({ timeZone }) because Hermes
// has historically ignored the timeZone option, which shifted the displayed slot
// by hours (the "1:00 am" bug). Pure arithmetic is correct on every engine.
const fmtSlotTime = (ms) => {
  if (!ms) return '10:00 pm';
  const year = new Date(ms).getUTCFullYear();
  const lastSundayUtc = (monthIndex) => {
    const d = new Date(Date.UTC(year, monthIndex + 1, 0, 1, 0, 0, 0));
    d.setUTCDate(d.getUTCDate() - d.getUTCDay());
    return d.getTime();
  };
  const isSummer = ms >= lastSundayUtc(2) && ms < lastSundayUtc(9);
  const uk = new Date(ms + (isSummer ? 60 * 60 * 1000 : 0));
  let h = uk.getUTCHours();
  const m = uk.getUTCMinutes();
  const ap = h >= 12 ? 'pm' : 'am';
  h %= 12;
  if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, '0')} ${ap}`;
};

const battleMs = (b) => {
  try {
    const t = b?.scheduledAt;
    if (!t) return 0;
    if (typeof t.toMillis === 'function') return t.toMillis();
    if (typeof t.seconds === 'number') return t.seconds * 1000;
    return new Date(t).getTime() || 0;
  } catch {
    return 0;
  }
};

const pickNextTeamBattle = (battles, nowMs) => {
  const rows = Array.isArray(battles) ? battles : [];
  const active = rows.filter((b) => {
    const st = String(b?.status || '');
    if (st === 'live') return true;
    if (st !== 'scheduled') return false;
    const at = battleMs(b);
    return at > 0 && at >= nowMs - 120000;
  });
  if (!active.length) return null;
  const live = active.find((b) => b.status === 'live');
  if (live) return live;
  return active
    .map((b) => ({ b, at: battleMs(b) }))
    .filter((x) => x.at > 0)
    .sort((a, b) => a.at - b.at)[0]?.b || null;
};

const isAuditionRelevant = (audition, uid, nowMs) => {
  if (!audition) return false;
  if (audition.status === AUDITION_STATUS.EXPIRED) return false;
  if (audition.decisions?.[uid] === 'declined') return false;
  if (audition.status === AUDITION_STATUS.COMPLETED) return true;
  const scheduledAt = Number(audition.scheduledAt) || 0;
  if (scheduledAt > 0 && nowMs > scheduledAt + 3 * 60 * 60 * 1000 && !audition.battleId) {
    return false;
  }
  return [AUDITION_STATUS.AWAITING, AUDITION_STATUS.MATCHED].includes(audition.status);
};

const TeamDetailScreen = ({ route, navigation }) => {
  const teamId = route?.params?.teamId;
  const { user, uid } = useAuth();
  const [team, setTeam] = useState(null);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [requesting, setRequesting] = useState(false);
  const [checkingIn, setCheckingIn] = useState(false);
  const [teamBattles, setTeamBattles] = useState([]);
  const [audition, setAudition] = useState(null);
  const [joinRequest, setJoinRequest] = useState(null);
  const [existingMembership, setExistingMembership] = useState(null);
  const [userFrames, setUserFrames] = useState({});
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const unsubTeam = subscribeTeam(teamId, (t) => { setTeam(t); setLoading(false); });
    const unsubMembers = subscribeTeamMembers(teamId, setMembers);
    return () => {
      try { unsubTeam && unsubTeam(); } catch {}
      try { unsubMembers && unsubMembers(); } catch {}
    };
  }, [teamId]);

  useEffect(() => {
    if (!teamId) {
      setTeamBattles([]);
      return undefined;
    }
    const unsub = subscribeTeamBattles(teamId, setTeamBattles);
    return () => { try { unsub && unsub(); } catch {} };
  }, [teamId]);

  // Live audition for this user (most recent where they're an applicant or the
  // matched opponent), so the VS card updates the moment an opponent locks in.
  useEffect(() => {
    if (!teamId || !uid) { setAudition(null); return undefined; }
    const unsub = subscribeAuditions(teamId, (list) => {
      const mine = (list || []).filter(
        (a) => (a.aUid === uid || a.bUid === uid) && isAuditionRelevant(a, uid, Date.now())
      );
      setAudition(mine[0] || null);
    });
    return () => { try { unsub && unsub(); } catch {} };
  }, [teamId, uid]);

  useEffect(() => {
    if (!teamId || !uid) {
      setJoinRequest(null);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        const jr = await getMyJoinRequest(teamId, uid);
        if (!cancelled) setJoinRequest(jr);
      } catch {
        if (!cancelled) setJoinRequest(null);
      }
    })();
    return () => { cancelled = true; };
  }, [teamId, uid]);

  useEffect(() => {
    if (!uid) {
      setExistingMembership(null);
      return undefined;
    }
    let cancelled = false;
    getMyMembership(uid).then((m) => {
      if (!cancelled) setExistingMembership(m);
    }).catch(() => {
      if (!cancelled) setExistingMembership(null);
    });
    return () => { cancelled = true; };
  }, [uid]);

  useEffect(() => {
    const uids = [...new Set([
      team?.leaderId,
      ...members.map((m) => m.uid || m.id),
    ].filter(Boolean))];
    if (!uids.length) {
      setUserFrames({});
      return undefined;
    }
    const unsubs = uids.map((id) => onSnapshot(
      doc(db, 'users', id),
      (snap) => {
        const frame = snap.exists() ? (snap.data()?.avatarFrame || null) : null;
        setUserFrames((prev) => (prev[id] === frame ? prev : { ...prev, [id]: frame }));
      },
      () => {},
    ));
    return () => { unsubs.forEach((u) => { try { u(); } catch {} }); };
  }, [team?.leaderId, members]);

  // 1s tick for battle / audition countdowns.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const nextBattle = useMemo(() => pickNextTeamBattle(teamBattles, now), [teamBattles, now]);
  const leaderMember = useMemo(
    () => {
      const m = members.find((x) => x.uid === team?.leaderId) || null;
      if (!m) return null;
      const frame = userFrames[m.uid || m.id] || m.avatarFrame || null;
      return frame ? { ...m, avatarFrame: frame } : m;
    },
    [members, team?.leaderId, userFrames]
  );
  const membersWithFrames = useMemo(
    () => members.map((m) => {
      const frame = userFrames[m.uid || m.id] || m.avatarFrame || null;
      return frame ? { ...m, avatarFrame: frame } : m;
    }),
    [members, userFrames]
  );

  const isMember = members.some((m) => m.uid === uid);
  const isLeader = team?.leaderId === uid;
  const myDecision = audition?.decisions?.[uid] || null;
  const auditionActive = !!uid && isAuditionRelevant(audition, uid, now);

  const onRequestJoin = async () => {
    if (!uid) {
      Alert.alert('Sign in required', 'Please sign in to request to join this team.');
      return;
    }
    if (existingMembership?.teamId && existingMembership.teamId !== teamId) {
      Alert.alert(
        'Already on a team',
        `You're already on ${existingMembership.team?.name || 'another team'}. Leave that team before joining another.`
      );
      return;
    }
    setRequesting(true);
    try {
      await requestToJoinTeam(teamId, { ...(user || {}), uid });
      const jr = await getMyJoinRequest(teamId, uid);
      setJoinRequest(jr);
      Alert.alert(
        'Request sent',
        `${team?.leaderName || 'The team leader'} will review your request. You'll get a notification when they respond.`
      );
    } catch (e) {
      Alert.alert('Could not send request', e?.message || 'Please try again.');
    } finally {
      setRequesting(false);
    }
  };

  const onAudition = async () => {
    if (!uid) {
      Alert.alert('Sign in required', 'Please sign in to audition for a team.');
      return;
    }
    setRequesting(true);
    try {
      const res = await requestAudition(teamId, { ...(user || {}), uid });
      if (res?.status === 'matched') {
        Alert.alert('You\u2019re locked in!', 'You\u2019ve been paired for tonight\u2019s 10pm audition battle.');
      } else if (res?.status === 'existing') {
        Alert.alert('Audition in progress', 'You already have an audition for this team.');
      } else {
        Alert.alert(
          'You\u2019re locked in!',
          'You\u2019re booked for the next 10pm UK audition. If no one else joins, the team leader takes the opposing spot. Check in from 30 minutes before.'
        );
      }
    } catch (e) {
      Alert.alert('Could not audition', e?.message || 'Please try again.');
    } finally {
      setRequesting(false);
    }
  };

  const onCheckIn = async () => {
    if (!audition?.id || !uid) return;
    setCheckingIn(true);
    try {
      await checkInAudition(audition.id, uid);
    } catch (e) {
      Alert.alert('Could not check in', e?.message || 'Please try again.');
    } finally {
      setCheckingIn(false);
    }
  };

  const renderBattleSlot = () => {
    if (nextBattle) return renderNextBattleCard();
    return <View style={styles.battleSlotEmpty} />;
  };

  const renderNextBattleCard = () => {
    if (!nextBattle) return null;

    const scheduledAt = battleMs(nextBattle);
    const isLive = nextBattle.status === 'live';
    const hasTime = scheduledAt > 0;
    const started = hasTime && now >= scheduledAt;
    const msToStart = hasTime ? scheduledAt - now : 0;

    return (
      <View style={styles.audCard}>
        <Text style={styles.audLockedLabel}>Next team battle</Text>

        <View style={styles.audVsRow}>
          <View style={styles.audSide}>
            <BlypAvatar uri={null} name={nextBattle.aName} size={64} showBadge={false} />
            <Text style={styles.audSideName} numberOfLines={1}>{nextBattle.aName || 'Member A'}</Text>
          </View>

          <Text style={styles.audVs}>VS</Text>

          <View style={styles.audSide}>
            <BlypAvatar uri={null} name={nextBattle.bName} size={64} showBadge={false} />
            <Text style={styles.audSideName} numberOfLines={1}>{nextBattle.bName || 'Member B'}</Text>
          </View>
        </View>

        {hasTime && (
          <View style={styles.audCountWrap}>
            <Text style={styles.audSlot}>
              {isLive ? 'Live now' : `Scheduled · ${fmtSlotTime(scheduledAt)} UK`}
            </Text>
            {!isLive && !started && msToStart > 0 ? (
              <Text style={styles.audCount}>{fmtCountdown(msToStart)}</Text>
            ) : null}
            {isLive || started ? (
              <Text style={styles.audLiveNow}>Live</Text>
            ) : null}
          </View>
        )}

        {!!nextBattle.note && (
          <Text style={styles.battleNote} numberOfLines={3}>{nextBattle.note}</Text>
        )}
      </View>
    );
  };

  const renderAuditionCard = () => {
    const meIsA = audition.aUid === uid;
    const me = { name: meIsA ? audition.aName : audition.bName, photo: meIsA ? audition.aPhoto : audition.bPhoto };
    const opp = meIsA
      ? { uid: audition.bUid, name: audition.bName, photo: audition.bPhoto }
      : { uid: audition.aUid, name: audition.aName, photo: audition.aPhoto };
    const hasOpponent = !!opp.uid;
    const scheduledAt = Number(audition.scheduledAt) || 0;
    const checkInOpensAt = Number(audition.checkInOpensAt) || (scheduledAt - AUDITION_CHECKIN_LEAD_MS);
    const msToStart = scheduledAt - now;
    const isCompleted = audition.status === AUDITION_STATUS.COMPLETED;
    const iCheckedIn = !!audition.checkIns?.[uid];
    const checkInOpen = now >= checkInOpensAt && !isCompleted;
    const started = scheduledAt > 0 && now >= scheduledAt;

    return (
      <View style={styles.audCard}>
        <Text style={styles.audLockedLabel}>
          <Ionicons name="lock-closed" size={12} color={COLORS.primary} /> You're locked in
        </Text>

        <View style={styles.audVsRow}>
          <View style={styles.audSide}>
            <BlypAvatar uri={me.photo} name={me.name} size={64} showBadge={false} />
            <Text style={styles.audSideName} numberOfLines={1}>{me.name || 'You'}</Text>
            {iCheckedIn ? <Text style={styles.audReady}>Ready</Text> : <Text style={styles.audSideTag}>You</Text>}
          </View>

          <Text style={styles.audVs}>VS</Text>

          <View style={styles.audSide}>
            {hasOpponent ? (
              <>
                <BlypAvatar uri={opp.photo} name={opp.name} size={64} showBadge={false} />
                <Text style={styles.audSideName} numberOfLines={1}>{opp.name || 'Opponent'}</Text>
                <Text style={styles.audSideTag}>{audition.bIsFallback && !meIsA ? '' : audition.bIsFallback ? 'Stand-in' : 'Opponent'}</Text>
              </>
            ) : (
              <>
                <View style={styles.audWaitingAvatar}>
                  <Ionicons name="person-add-outline" size={26} color={COLORS.textMuted} />
                </View>
                <Text style={styles.audSideName} numberOfLines={1}>Waiting…</Text>
                <Text style={styles.audSideTag}>Finding opponent</Text>
              </>
            )}
          </View>
        </View>

        {scheduledAt > 0 && !isCompleted && (
          <View style={styles.audCountWrap}>
            <Text style={styles.audSlot}>Tonight's audition · {fmtSlotTime(scheduledAt)} UK</Text>
            {!started && msToStart > 0 ? (
              <Text style={styles.audCount}>{fmtCountdown(msToStart)}</Text>
            ) : started && audition.battleId ? (
              <Text style={styles.audLiveNow}>Ready to go live</Text>
            ) : null}
          </View>
        )}

        {isCompleted ? (
          <View style={[styles.cta, styles.ctaPending, { marginBottom: 0 }]}>
            <Ionicons name="hourglass-outline" size={18} color={COLORS.textSecondary} />
            <Text style={styles.ctaPendingText}>Audition under review by the leader</Text>
          </View>
        ) : audition.battleId && (started || iCheckedIn) ? (
          <TouchableOpacity
            style={[styles.cta, styles.ctaPrimary, { marginBottom: 0 }]}
            activeOpacity={0.9}
            onPress={() => { try { navigation.navigate('BattleDetail', { battleId: audition.battleId }); } catch {} }}
          >
            <Ionicons name="flash" size={18} color="#001b18" />
            <Text style={styles.ctaPrimaryText}>{started ? 'Go live now' : 'Open your battle'}</Text>
          </TouchableOpacity>
        ) : checkInOpen && !iCheckedIn ? (
          <TouchableOpacity
            style={[styles.cta, styles.ctaPrimary, { marginBottom: 0 }]}
            activeOpacity={0.9}
            onPress={onCheckIn}
            disabled={checkingIn}
          >
            {checkingIn ? <ActivityIndicator color="#001b18" /> : (
              <>
                <Ionicons name="hand-right-outline" size={18} color="#001b18" />
                <Text style={styles.ctaPrimaryText}>Check in — I'm here</Text>
              </>
            )}
          </TouchableOpacity>
        ) : iCheckedIn ? (
          <View style={[styles.cta, styles.ctaMember, { marginBottom: 0 }]}>
            <Ionicons name="checkmark-circle" size={18} color={COLORS.success} />
            <Text style={styles.ctaMemberText}>Checked in — be ready at {fmtSlotTime(scheduledAt)}</Text>
          </View>
        ) : (
          <View style={[styles.cta, styles.ctaPending, { marginBottom: 0 }]}>
            <Ionicons name="time-outline" size={18} color={COLORS.textSecondary} />
            <Text style={styles.ctaPendingText}>Check-in opens 30 min before</Text>
          </View>
        )}
      </View>
    );
  };

  const renderJoinCta = () => {
    if (isMember || isLeader) {
      return (
        <View style={[styles.cta, styles.ctaMember]}>
          <Ionicons name="checkmark-circle" size={18} color={COLORS.success} />
          <Text style={styles.ctaMemberText}>{isLeader ? 'You lead this team' : "You're a member"}</Text>
        </View>
      );
    }
    const joinPending = joinRequest?.status === JOIN_STATUS.PENDING;
    const joinRejected = joinRequest?.status === JOIN_STATUS.REJECTED;
    return (
      <>
        {joinPending ? (
          <View style={[styles.cta, styles.ctaPending]}>
            <Ionicons name="hourglass-outline" size={18} color={COLORS.textSecondary} />
            <Text style={styles.ctaPendingText}>Join request pending — waiting for {team?.leaderName || 'leader'}</Text>
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.cta, styles.ctaPrimary]}
            activeOpacity={0.9}
            onPress={onRequestJoin}
            disabled={requesting}
          >
            {requesting ? <ActivityIndicator color="#001b18" /> : (
              <>
                <Ionicons name="person-add" size={18} color="#001b18" />
                <Text style={styles.ctaPrimaryText}>Join team</Text>
              </>
            )}
          </TouchableOpacity>
        )}
        <Text style={styles.ctaHint}>
          {joinRejected
            ? 'Your last join request wasn\u2019t accepted. You can try again or audition below.'
            : 'Send a join request to the team leader. They can accept you straight onto the roster.'}
        </Text>
        {!joinPending && (
          <>
            <TouchableOpacity style={[styles.cta, styles.ctaSecondary]} activeOpacity={0.9} onPress={onAudition} disabled={requesting || auditionActive}>
              {requesting ? <ActivityIndicator color={COLORS.primary} /> : (
                <>
                  <Ionicons name="mic-outline" size={18} color={COLORS.primary} />
                  <Text style={styles.ctaSecondaryText}>{auditionActive ? 'Audition in progress' : 'Audition for the agency'}</Text>
                </>
              )}
            </TouchableOpacity>
            <Text style={styles.ctaHint}>
              Auditioning puts you in a live battle with another applicant. The team leader reviews the result and decides.
            </Text>
          </>
        )}
      </>
    );
  };

  return (
    <ScreenContainer>
      <View style={styles.topRow}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation?.goBack?.()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>{team?.name || 'Team'}</Text>
        <View style={styles.backBtn} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={COLORS.primary} /></View>
      ) : !team ? (
        <View style={styles.center}><Text style={styles.emptyText}>This team is no longer available.</Text></View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <BlypAvatar
              uri={team.leaderPhoto}
              name={team.leaderName}
              size={128}
              showBadge={false}
              profile={leaderMember}
              frame={leaderMember?.avatarFrame}
            />
            <Text style={styles.teamName}>{team.name}</Text>
            <Text style={styles.teamMeta}>
              Led by {team.leaderName || 'Leader'} · {team.memberCount || members.length} member{(team.memberCount || members.length) === 1 ? '' : 's'}
            </Text>
            {!!team.description && <Text style={styles.teamDesc}>{team.description}</Text>}
          </View>

          {renderBattleSlot()}
          {renderJoinCta()}
          {auditionActive ? (
            <>
              <Text style={styles.sectionLabel}>Your audition</Text>
              {renderAuditionCard()}
            </>
          ) : null}

          <Text style={styles.sectionLabel}>Members</Text>
          {members.length === 0 ? (
            <Text style={styles.emptyText}>No members listed yet.</Text>
          ) : (
            membersWithFrames.map((m) => (
              <View key={m.uid} style={styles.memberRow}>
                <BlypAvatar uri={m.photoURL} name={m.displayName} size={40} showBadge={false} profile={m} frame={m.avatarFrame} />
                <View style={styles.memberBody}>
                  <Text style={styles.memberName}>{m.displayName || 'Member'}</Text>
                  <Text style={styles.memberRole}>{m.role === 'leader' ? 'Team leader' : 'Member'}</Text>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 8 },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', color: COLORS.textPrimary, fontSize: 18, fontWeight: '800' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  scroll: { padding: 16, paddingBottom: 120 },
  header: { alignItems: 'center', gap: 8, marginBottom: 18 },
  teamName: { color: COLORS.textPrimary, fontSize: 22, fontWeight: '800', marginTop: 6 },
  teamMeta: { color: COLORS.textSecondary, fontSize: 13 },
  teamDesc: { color: COLORS.textMuted, fontSize: 13, textAlign: 'center', lineHeight: 19, marginTop: 8 },
  cta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 12, marginBottom: 10 },
  ctaHint: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, textAlign: 'center', marginBottom: 22 },
  audCard: { backgroundColor: COLORS.backgroundCard, borderRadius: 16, padding: 16, marginBottom: 22, borderWidth: 1, borderColor: COLORS.border, gap: 14 },
  battleSlotEmpty: { minHeight: 8, marginBottom: 18 },
  audLockedLabel: { color: COLORS.primary, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5, textAlign: 'center' },
  audVsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  audSide: { flex: 1, alignItems: 'center', gap: 6 },
  audSideName: { color: COLORS.textPrimary, fontSize: 14, fontWeight: '700', maxWidth: 110, textAlign: 'center' },
  audSideTag: { color: COLORS.textMuted, fontSize: 11 },
  audReady: { color: COLORS.success, fontSize: 11, fontWeight: '800' },
  audVs: { color: COLORS.primary, fontSize: 20, fontWeight: '900', paddingHorizontal: 8 },
  audWaitingAvatar: { width: 64, height: 64, borderRadius: 32, borderWidth: 1.5, borderStyle: 'dashed', borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center' },
  audCountWrap: { alignItems: 'center', gap: 2 },
  audSlot: { color: COLORS.textSecondary, fontSize: 12 },
  audCount: { color: COLORS.textPrimary, fontSize: 30, fontWeight: '900', fontVariant: ['tabular-nums'], letterSpacing: 1 },
  audLiveNow: { color: COLORS.primary, fontSize: 16, fontWeight: '800', marginTop: 4 },
  battleNote: { color: COLORS.textMuted, fontSize: 12, textAlign: 'center', lineHeight: 17 },
  ctaPrimary: { backgroundColor: COLORS.primary },
  ctaPrimaryText: { color: '#001b18', fontWeight: '800', fontSize: 15 },
  ctaSecondary: { backgroundColor: COLORS.backgroundCard, borderWidth: 1, borderColor: COLORS.border },
  ctaSecondaryText: { color: COLORS.primary, fontWeight: '800', fontSize: 15 },
  ctaPending: { backgroundColor: COLORS.backgroundCard, borderWidth: 1, borderColor: COLORS.border },
  ctaPendingText: { color: COLORS.textSecondary, fontWeight: '700' },
  ctaMember: { backgroundColor: 'rgba(52,211,153,0.1)', borderWidth: 1, borderColor: 'rgba(52,211,153,0.4)' },
  ctaMemberText: { color: COLORS.success, fontWeight: '700' },
  sectionLabel: { color: COLORS.textMuted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  memberBody: { flex: 1 },
  memberName: { color: COLORS.textPrimary, fontSize: 15, fontWeight: '700' },
  memberRole: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  emptyText: { color: COLORS.textMuted, fontSize: 13, textAlign: 'center' },
});

export default TeamDetailScreen;
