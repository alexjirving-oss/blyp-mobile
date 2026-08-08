// TeamsContent — the official "Teams" surface (TikTok-agency style).
//
// Shows the list of teams, a "My Team" shortcut, and an "Apply to run a team"
// action. Tapping a team opens TeamDetail where a user can request to join.

import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  TextInput,
  Alert,
  RefreshControl,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Icon from '../Icon';
import BlypAvatar from '../BlypAvatar';
import PressableLift from '../motion/PressableLift';
import { COLORS } from '../../styles/theme';
import { useAuth } from '../../hooks/useCommon';
import { subscribeTeams, applyToRunTeam, getMyMembership } from '../../services/teamsService';
import { fetchVerificationState, isProfileVerified } from '../../services/verificationService';

const TeamsContent = ({ navigation }) => {
  const { user, uid } = useAuth();
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [myTeamId, setMyTeamId] = useState(null);
  const [applyOpen, setApplyOpen] = useState(false);
  const [pitch, setPitch] = useState('');
  const [applying, setApplying] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    const unsub = subscribeTeams((list) => {
      setTeams(list || []);
      setLoading(false);
    });
    return () => {
      try { unsub && unsub(); } catch {}
    };
  }, []);

  const refreshMembership = useCallback(async () => {
    if (!uid) return;
    const m = await getMyMembership(uid);
    setMyTeamId(m?.teamId || null);
    try {
      const state = await fetchVerificationState(uid);
      setVerified(!!state.verified || isProfileVerified(state));
    } catch {
      setVerified(false);
    }
  }, [uid]);

  useEffect(() => { refreshMembership(); }, [refreshMembership]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refreshMembership();
    setRefreshing(false);
  }, [refreshMembership]);

  const openApply = () => {
    if (!uid) {
      Alert.alert('Sign in required', 'Please sign in to apply to run a team.');
      return;
    }
    if (!verified) {
      Alert.alert(
        'Verification required',
        'Verify your profile before applying to run a team. You can submit identity info or link an authenticator in Edit Profile.',
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Edit Profile', onPress: () => navigation?.navigate?.('EditProfile') },
        ],
      );
      return;
    }
    setApplyOpen(true);
  };

  const submitApplication = async () => {
    if (!pitch.trim()) {
      Alert.alert('Tell us about your team', 'Add a short pitch so we know what your team is about.');
      return;
    }
    if (!uid) {
      Alert.alert('Sign in required', 'Please sign in to apply to run a team.');
      return;
    }
    if (!verified) {
      Alert.alert(
        'Verification required',
        'Verify your profile before applying to run a team.',
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Edit Profile', onPress: () => navigation?.navigate?.('EditProfile') },
        ],
      );
      return;
    }
    setApplying(true);
    try {
      await applyToRunTeam(
        {
          uid,
          displayName:
            user?.attributes?.name ||
            user?.attributes?.preferred_username ||
            user?.username ||
            (typeof user?.getUsername === 'function' ? user.getUsername() : null) ||
            'Creator',
          photoURL: user?.attributes?.picture || user?.photoURL || null,
          attributes: user?.attributes,
          username: user?.username,
        },
        pitch.trim(),
      );
      setApplyOpen(false);
      setPitch('');
      Alert.alert('Application sent', "Thanks! We'll review your team and be in touch in your notifications.");
    } catch (e) {
      const msg = e?.message || 'Please try again.';
      if (String(msg).toLowerCase().includes('verify')) {
        Alert.alert('Verification required', msg, [
          { text: 'Not now', style: 'cancel' },
          { text: 'Edit Profile', onPress: () => navigation?.navigate?.('EditProfile') },
        ]);
      } else {
        Alert.alert('Something went wrong', msg);
      }
    } finally {
      setApplying(false);
    }
  };

  const renderTeam = ({ item }) => (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.85}
      onPress={() => navigation?.navigate?.('TeamDetail', { teamId: item.id })}
    >
      <BlypAvatar uri={item.leaderPhoto} name={item.leaderName} size={96} showBadge={false} />
      <View style={styles.cardBody}>
        <Text style={styles.teamName} numberOfLines={1}>{item.name || 'Team'}</Text>
        <Text style={styles.teamMeta} numberOfLines={1}>
          Led by {item.leaderName || 'Leader'} · {item.memberCount || 0} member{(item.memberCount || 0) === 1 ? '' : 's'}
        </Text>
        <Text style={styles.teamJoinHint}>Tap to view & join</Text>
        {!!item.description && (
          <Text style={styles.teamDesc} numberOfLines={2}>{item.description}</Text>
        )}
      </View>
      <Icon name="chevron-forward" size={20} color={COLORS.textMuted} />
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={teams}
        keyExtractor={(t) => t.id}
        renderItem={renderTeam}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
        ListHeaderComponent={
          <View>
            <View style={styles.hero}>
              <LinearGradient
                colors={['rgba(0,210,190,0.28)', 'rgba(0,168,158,0.05)', 'transparent']}
                style={StyleSheet.absoluteFill}
              />
              <Text style={styles.heroEyebrow}>Teams</Text>
              <Text style={styles.heroTitle}>Your creator crew</Text>
              <Text style={styles.heroText}>
                Official agencies on Blyp — battles, group goals, and a roster that has your back.
              </Text>
            </View>
            <View style={styles.actionsRow}>
              <PressableLift
                style={[styles.actionBtn, styles.actionPrimary]}
                contentStyle={styles.actionBtnInner}
                onPress={() => navigation?.navigate?.('MyTeam')}
              >
                <Icon name="ribbon-outline" size={18} color="#001b18" />
                <Text style={styles.actionPrimaryText}>{myTeamId ? 'My Team dashboard' : 'My Team'}</Text>
              </PressableLift>
              <PressableLift
                style={[styles.actionBtn, styles.actionGhost]}
                contentStyle={styles.actionBtnInner}
                onPress={openApply}
              >
                <Icon name="add-circle-outline" size={18} color={COLORS.primary} />
                <Text style={styles.actionGhostText}>
                  {verified ? 'Apply to run a team' : 'Verify to run a team'}
                </Text>
              </PressableLift>
            </View>
            <Text style={styles.sectionLabel}>All teams</Text>
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <View style={styles.center}><ActivityIndicator color={COLORS.primary} /></View>
          ) : (
            <View style={styles.center}>
              <Icon name="people-outline" size={42} color={COLORS.textMuted} />
              <Text style={styles.emptyText}>No teams yet. Be the first to apply to run one!</Text>
            </View>
          )
        }
      />

      <Modal visible={applyOpen} transparent animationType="fade" onRequestClose={() => setApplyOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Apply to run a team</Text>
            <Text style={styles.modalSub}>
              Tell us about your team — who it's for, your experience, and your goals. Running a team
              requires a verified Blyp profile.
            </Text>
            <TextInput
              style={styles.modalInput}
              value={pitch}
              onChangeText={setPitch}
              placeholder="Your pitch…"
              placeholderTextColor={COLORS.textMuted}
              multiline
              maxLength={1000}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setApplyOpen(false)} disabled={applying}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalConfirm} onPress={submitApplication} disabled={applying}>
                {applying ? <ActivityIndicator color="#001b18" /> : <Text style={styles.modalConfirmText}>Send application</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.pageBackground },
  listContent: { padding: 16, paddingBottom: 120 },
  hero: {
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#0E1214',
    borderWidth: 1,
    borderColor: 'rgba(0,210,190,0.22)',
    padding: 18,
    marginBottom: 16,
    minHeight: 120,
  },
  heroEyebrow: {
    color: COLORS.primary,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  heroTitle: { color: COLORS.textPrimary, fontSize: 24, fontWeight: '900', marginTop: 6, letterSpacing: -0.3 },
  heroText: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 8 },
  actionsRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  actionBtn: { flex: 1, borderRadius: 12, overflow: 'hidden' },
  actionBtnInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12 },
  actionPrimary: { backgroundColor: COLORS.primary },
  actionPrimaryText: { color: '#001b18', fontWeight: '800', fontSize: 13 },
  actionGhost: { borderWidth: 1, borderColor: COLORS.primary, backgroundColor: 'rgba(0,210,190,0.06)' },
  actionGhostText: { color: COLORS.primary, fontWeight: '700', fontSize: 12 },
  sectionLabel: { color: COLORS.textMuted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: COLORS.backgroundCard, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: COLORS.border },
  cardBody: { flex: 1 },
  teamName: { color: COLORS.textPrimary, fontSize: 16, fontWeight: '800' },
  teamMeta: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  teamJoinHint: { color: COLORS.primary, fontSize: 11, fontWeight: '700', marginTop: 4 },
  teamDesc: { color: COLORS.textMuted, fontSize: 12, marginTop: 6, lineHeight: 17 },
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: 48, gap: 12 },
  emptyText: { color: COLORS.textMuted, fontSize: 13, textAlign: 'center', paddingHorizontal: 24 },
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
});

export default TeamsContent;
