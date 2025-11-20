// ModerationQueueScreen: admin-only moderation queue viewer (thin orchestration)
// Domain: Trust & Safety. Renders aggregated moderation queue entries.
// NOTE: Actual admin gating not implemented; integrate with role system later.

import React from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import useModerationQueue from '../hooks/useModerationQueue';
import useIsAdmin from '../hooks/useIsAdmin';
import { useAuth } from '../hooks/useCommon';

export default function ModerationQueueScreen() {
  const { isAdmin, loading: roleLoading } = useIsAdmin();
  const { items, loading, markUnderReview, resolve, refresh } = useModerationQueue({ auto: isAdmin, limit: 50 });
  const { user } = useAuth();

  if (roleLoading) {
    return (<View style={styles.container}><ActivityIndicator color="#ec4899" /></View>);
  }
  if (!isAdmin) {
    return (
      <View style={styles.container}>
        <Text style={styles.header}>Moderation Queue</Text>
        <Text style={styles.denied}>Access restricted. Admin role required.</Text>
      </View>
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
              <Text style={styles.actionText}>Resolve</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Moderation Queue</Text>
      <TouchableOpacity onPress={refresh} style={styles.refresh}>
        <Text style={styles.refreshText}>Refresh</Text>
      </TouchableOpacity>
      {loading && <ActivityIndicator color="#ec4899" style={{ marginVertical: 12 }} />}
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
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a', padding: 16 },
  header: { fontSize: 20, fontWeight: '700', color: '#f1f5f9', marginBottom: 8 },
  denied: { color: '#f87171', fontSize: 14 },
  refresh: { alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 12, backgroundColor: '#334155', borderRadius: 6, marginBottom: 8 },
  refreshText: { color: '#f1f5f9', fontWeight: '600' },
  card: { backgroundColor: '#1e293b', padding: 12, borderRadius: 10, marginBottom: 12 },
  target: { color: '#f1f5f9', fontSize: 14, fontWeight: '600' },
  meta: { color: '#94a3b8', fontSize: 12, marginTop: 4 },
  reasons: { color: '#cbd5e1', fontSize: 12, marginTop: 6 },
  actions: { flexDirection: 'row', marginTop: 10 },
  actionBtn: { backgroundColor: '#64748b', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 6, marginRight: 8 },
  resolveBtn: { backgroundColor: '#ec4899' },
  actionText: { color: '#f1f5f9', fontSize: 12, fontWeight: '600' },
  empty: { color: '#64748b', textAlign: 'center', marginTop: 30 }
});
