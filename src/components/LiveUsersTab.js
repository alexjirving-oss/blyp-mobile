import React, { useEffect, useState } from "react";
import { View, Text, FlatList, TouchableOpacity, Image, StyleSheet, ActivityIndicator } from "react-native";
import { subscribeToLiveUsers } from "../services/LiveService";
import { useNavigation } from "@react-navigation/native";
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function LiveUsersTab() {
  const [liveUsers, setLiveUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    console.log('📡 LiveUsersTab: Setting up live users subscription');
    const unsub = subscribeToLiveUsers((users) => {
      console.log(`📊 LiveUsersTab: Received ${users.length} live users`);
      console.log('📊 Raw users array:', JSON.stringify(users, null, 2));
      users.forEach((user, index) => {
        console.log(`  User ${index + 1}:`, {
          id: user.id,
          displayName: user.displayName,
          photoURL: user.photoURL ? 'yes' : 'no',
          currentStreamId: user.currentStreamId,
          status: user.status
        });
      });
      setLiveUsers(users);
      setLoading(false);
    });
    return () => {
      console.log('🔌 LiveUsersTab: Cleaning up subscription');
      unsub();
    };
  }, []);

  if (loading) {
    return (
      <View style={[styles.centerContainer, { paddingTop: insets.top + 10 }]}>
        <ActivityIndicator size="large" color="#FF1493" />
        <Text style={styles.loadingText}>Loading live users...</Text>
      </View>
    );
  }

  if (!liveUsers.length) {
    console.log('⚠️ LiveUsersTab: No live users, showing empty state');
    return (
      <View style={[styles.centerContainer, { paddingTop: insets.top + 10 }]}>
        <Text style={styles.emptyIcon}>📱</Text>
        <Text style={styles.emptyTitle}>Nobody is live right now</Text>
        <Text style={styles.emptySubtitle}>Be the first to go live!</Text>
      </View>
    );
  }

  console.log('✅ LiveUsersTab: Rendering FlatList with', liveUsers.length, 'users');
  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['#1a1a2e', '#16213e']}
        style={styles.gradient}
      >
        <FlatList
          data={liveUsers}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[styles.listContainer, { paddingTop: insets.top + 10 }]}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.card}
              onPress={() => {
                console.log(`🎯 Navigating to stream for user: ${item.id}`);
                navigation.navigate("LiveStreamScreen", {
                  mode: "viewer",
                  hostUid: item.id,
                  streamId: item.currentStreamId || item.id,
                  displayName: item.displayName || 'Unknown',
                });
              }}
              activeOpacity={0.7}
            >
              <View style={styles.avatarContainer}>
                <Image
                  source={{ uri: item.photoURL || "https://ui-avatars.com/api/?name=" + encodeURIComponent(item.displayName || "User") }}
                  style={styles.avatar}
                />
                <View style={styles.liveBadge}>
                  <Text style={styles.liveText}>LIVE</Text>
                </View>
              </View>
              <View style={styles.infoContainer}>
                <Text style={styles.name} numberOfLines={1}>
                  {item.displayName || "Unknown"}
                </Text>
                <View style={styles.statusRow}>
                  <Text style={styles.liveIndicator}>🔴</Text>
                  <Text style={styles.status}>Broadcasting now</Text>
                </View>
                {item.currentStreamTitle && (
                  <Text style={styles.streamTitle} numberOfLines={1}>
                    {item.currentStreamTitle}
                  </Text>
                )}
              </View>
              <View style={styles.chevron}>
                <Text style={styles.chevronText}>›</Text>
              </View>
            </TouchableOpacity>
          )}
        />
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  gradient: {
    flex: 1,
  },
  listContainer: {
    padding: 16,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
    padding: 20,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#fff',
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 16,
    color: '#888',
    textAlign: 'center',
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 20, 147, 0.3)',
  },
  avatarContainer: {
    position: 'relative',
    marginRight: 16,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2,
    borderColor: '#FF1493',
  },
  liveBadge: {
    position: 'absolute',
    bottom: -4,
    right: -4,
    backgroundColor: '#FF0000',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 2,
    borderColor: '#1a1a2e',
  },
  liveText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
  },
  infoContainer: {
    flex: 1,
  },
  name: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 4,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  liveIndicator: {
    fontSize: 12,
    marginRight: 4,
  },
  status: {
    fontSize: 14,
    color: '#FF1493',
    fontWeight: '600',
  },
  streamTitle: {
    fontSize: 13,
    color: '#aaa',
    marginTop: 4,
    fontStyle: 'italic',
  },
  chevron: {
    marginLeft: 8,
  },
  chevronText: {
    fontSize: 32,
    color: '#FF1493',
    fontWeight: '300',
  },
});
