// ModerationQueueScreen: admin-only moderation queue viewer (thin orchestration)
// Domain: Trust & Safety. Renders aggregated moderation queue entries.
// NOTE: Actual admin gating not implemented; integrate with role system later.

import React from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import useModerationQueue from '../hooks/useModerationQueue';
import useIsAdmin from '../hooks/useIsAdmin';
import { useAuth } from '../hooks/useCommon';
import { COLORS } from '../styles/theme';

export default function ModerationQueueScreen() {
  const { isAdmin, loading: roleLoading } = useIsAdmin();
  const { items, loading, markUnderReview, resolve, refresh } = useModerationQueue({ auto: isAdmin, limit: 50 });
  const { user, authReady } = useAuth();

  if (roleLoading) {
    return (
      <ScreenContainer>
        <View style={styles.container}><ActivityIndicator color="#FF2D55" /></View>
      </ScreenContainer>
    );
  }
  if (!isAdmin) {
    return (
      <ScreenContainer>
        <View style={styles.container}>
          <Text style={styles.header}>Moderation Queue</Text>
          <Text style={styles.denied}>Access restricted. Admin role required.</Text>
        </View>
      </ScreenContainer>
    );
  }

  const renderItem = ({ item }) => {
    const reasons = Object.entries(item.reasons || {}).map(([code, count]) => `${code}:${count}`).join(', ');
    return (
      <View style={styles.card}>
        <Text style={styles.target}>{item.targetType}:{item.targetId}</Text>
        <Text style={styles.meta}>Reports: {item.totalReports} | Priority: {item.priorityScore?.toFixed?.(2) || item.priorityScore}</Text>
        <Text style={styles.reasons}>{reasons}</Text>
        <View style={styles.actions}>
          {item.status === 'pending_review' && (
            <TouchableOpacity style={styles.actionBtn} onPress={() => markUnderReview(item.id, user?.uid)}>
              <Text style={styles.actionText}>Under Review</Text>
            </TouchableOpacity>
          )}
          {item.status !== 'resolved' && (
            <TouchableOpacity style={[styles.actionBtn, styles.resolveBtn]} onPress={() => resolve(item.id, { actionType: 'action_taken' }, user?.uid)}>
              <Text style={[styles.actionText, { color: '#FFFFFF' }]}>Resolve</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  return (
    <ScreenContainer>
      <View style={styles.container}>
        <Text style={styles.header}>Moderation Queue</Text>
        <TouchableOpacity onPress={refresh} style={styles.refresh}>
          <Text style={styles.refreshText}>Refresh</Text>
        </TouchableOpacity>
        {loading && <ActivityIndicator color="#FF2D55" style={{ marginVertical: 12 }} />}
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: 40 }}
          ListEmptyComponent={!loading && (
            <Text style={styles.empty}>Queue empty</Text>
          )}
        />
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent', padding: 16 },
  header: { fontSize: 20, fontWeight: '700', color: '#f1f5f9', marginBottom: 8 },
  denied: { color: '#f87171', fontSize: 14 },
  refresh: { alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 12, backgroundColor: '#27272E', borderRadius: 6, marginBottom: 8 },
  refreshText: { color: '#f1f5f9', fontWeight: '600' },
  card: { backgroundColor: '#141418', padding: 12, borderRadius: 10, marginBottom: 12 },
  target: { color: '#f1f5f9', fontSize: 14, fontWeight: '600' },
  meta: { color: '#A1A1AA', fontSize: 12, marginTop: 4 },
  reasons: { color: '#D4D4D8', fontSize: 12, marginTop: 6 },
  actions: { flexDirection: 'row', marginTop: 10 },
  actionBtn: { backgroundColor: '#71717A', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 6, marginRight: 8 },
  resolveBtn: { backgroundColor: '#FF2D55' },
  actionText: { color: '#f1f5f9', fontSize: 12, fontWeight: '600' },
  empty: { color: '#71717A', textAlign: 'center', marginTop: 30 }
});
