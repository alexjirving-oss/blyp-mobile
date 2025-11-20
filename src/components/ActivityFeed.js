import React, { useState, useEffect } from 'react';
import Icon from './Icon';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  RefreshControl,
} from 'react-native';
import firebase, { auth as authExport, db } from '../config/firebase';
import { getUserActivities, ACTIVITY_TYPES } from '../utils/activityTracker';

const ActivityFeed = ({ navigation }) => {
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actorProfiles, setActorProfiles] = useState({});
  const authObj = (typeof authExport === 'function' ? authExport() : authExport) || (firebase?.auth?.() || {});
  const user = authObj.currentUser;

  useEffect(() => {
    if (!user) return;

    const unsubscribe = getUserActivities(user.uid, 50, async (snapshot) => {
      console.log('🎯 Activity Feed: Received', snapshot.docs.length, 'activities');
      
      const activitiesData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      // Get actor profiles for activities
      const uniqueActorIds = [...new Set(activitiesData.map(activity => activity.actorId))];
      const profiles = {};

      for (const actorId of uniqueActorIds) {
        if (!actorProfiles[actorId]) {
          try {
            const userDoc = await db.collection('users').doc(actorId).get();
            if (userDoc.exists) {
              profiles[actorId] = userDoc.data();
            } else {
              // Create fallback profile based on user ID
              const fallbackName = generateFallbackName(actorId);
              profiles[actorId] = {
                displayName: fallbackName,
                username: fallbackName.toLowerCase().replace(' ', '_'),
                photoURL: `https://ui-avatars.com/api/?name=${encodeURIComponent(fallbackName)}&background=374151&color=e5e7eb&size=100`
              };
            }
          } catch (error) {
            console.error('❌ Error fetching actor profile for', actorId, ':', error);
            // Create fallback profile based on user ID
            const fallbackName = generateFallbackName(actorId);
            profiles[actorId] = {
              displayName: fallbackName,
              username: fallbackName.toLowerCase().replace(' ', '_'),
              photoURL: `https://ui-avatars.com/api/?name=${encodeURIComponent(fallbackName)}&background=374151&color=e5e7eb&size=100`
            };
          }
        }
      }

      setActorProfiles(prev => ({ ...prev, ...profiles }));
      setActivities(activitiesData);
      setLoading(false);
      setRefreshing(false);
    });

    return unsubscribe;
  }, [user]);

  const onRefresh = () => {
    setRefreshing(true);
  };

  const generateFallbackName = (userId) => {
    // Create a consistent name based on user ID
    // Removed hardcoded user ID check
    
    // Generate names based on hash of user ID for consistency
    const names = ['Alex Smith', 'Jordan Lee', 'Casey Brown', 'Riley Davis', 'Morgan Wilson'];
    const hash = userId.split('').reduce((a, b) => {
      a = ((a << 5) - a) + b.charCodeAt(0);
      return a & a;
    }, 0);
    return names[Math.abs(hash) % names.length];
  };

  const getActivityIcon = (type) => {
    switch (type) {
      case ACTIVITY_TYPES.LIKE:
        return { name: 'heart', color: '#ff1744' };
      case ACTIVITY_TYPES.UNLIKE:
        return { name: 'heart-outline', color: '#9ca3af' };
      case ACTIVITY_TYPES.SHARE:
        return { name: 'share-outline', color: '#10b981' };
      case ACTIVITY_TYPES.PROFILE_VIEW:
        return { name: 'eye-outline', color: '#3b82f6' };
      case ACTIVITY_TYPES.COMMENT:
        return { name: 'chatbubble-outline', color: '#f59e0b' };
      case ACTIVITY_TYPES.FOLLOW:
        return { name: 'person-add-outline', color: '#8b5cf6' };
      default:
        return { name: 'notifications-outline', color: '#6b7280' };
    }
  };

  const getActivityText = (activity) => {
    const actorName = actorProfiles[activity.actorId]?.displayName || 'Someone';
    
    switch (activity.type) {
      case ACTIVITY_TYPES.LIKE:
        return `${actorName} liked your ${activity.metadata?.postTitle ? 'video' : 'post'}`;
      case ACTIVITY_TYPES.UNLIKE:
        return `${actorName} unliked your ${activity.metadata?.postTitle ? 'video' : 'post'}`;
      case ACTIVITY_TYPES.SHARE:
        return `${actorName} shared your ${activity.metadata?.postTitle ? 'video' : 'post'}`;
      case ACTIVITY_TYPES.PROFILE_VIEW:
        return `${actorName} viewed your profile`;
      case ACTIVITY_TYPES.COMMENT:
        return `${actorName} commented on your post`;
      case ACTIVITY_TYPES.FOLLOW:
        return `${actorName} started following you`;
      default:
        return `${actorName} interacted with your content`;
    }
  };

  const formatTime = (timestamp) => {
    if (!timestamp) return 'Just now';
    
    const now = new Date();
    const activityTime = timestamp.toDate();
    const diffInSeconds = Math.floor((now - activityTime) / 1000);

    if (diffInSeconds < 60) {
      return 'Just now';
    } else if (diffInSeconds < 3600) {
      const minutes = Math.floor(diffInSeconds / 60);
      return `${minutes}m ago`;
    } else if (diffInSeconds < 86400) {
      const hours = Math.floor(diffInSeconds / 3600);
      return `${hours}h ago`;
    } else {
      const days = Math.floor(diffInSeconds / 86400);
      return `${days}d ago`;
    }
  };

  const handleActivityPress = (activity) => {
    if (activity.metadata?.postId) {
      // Navigate to the post if it exists
      navigation.navigate('PostPreview', { postId: activity.metadata.postId });
    } else if (activity.type === ACTIVITY_TYPES.PROFILE_VIEW) {
      // Navigate to the actor's profile
      navigation.navigate('UserProfile', { userId: activity.actorId });
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>Loading activities...</Text>
      </View>
    );
  }

  if (activities.length === 0) {
    return (
      <ScrollView
        style={styles.container}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <View style={styles.emptyContainer}>
          <Icon  name="notifications-outline" size={64} color="#6b7280"  />
          <Text style={styles.emptyTitle}>No Activity Yet</Text>
          <Text style={styles.emptyText}>
            When people interact with your content, you'll see it here
          </Text>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      {activities.map((activity) => {
        const icon = getActivityIcon(activity.type);
        const actorProfile = actorProfiles[activity.actorId];

        return (
          <TouchableOpacity
            key={activity.id}
            style={[styles.activityItem, !activity.read && styles.unreadActivity]}
            onPress={() => handleActivityPress(activity)}
          >
            <Image
              source={{
                uri: actorProfile?.photoURL || 
                  `https://placehold.co/40x40/475569/e2e8f0?text=${actorProfile?.displayName?.charAt(0)?.toUpperCase() || 'U'}`
              }}
              style={styles.actorAvatar}
            />
            
            <View style={styles.activityContent}>
              <Text style={styles.activityText}>
                {getActivityText(activity)}
              </Text>
              
              {activity.metadata?.postTitle && (
                <Text style={styles.postTitle} numberOfLines={1}>
                  "{activity.metadata.postTitle}"
                </Text>
              )}
              
              <Text style={styles.activityTime}>
                {formatTime(activity.timestamp)}
              </Text>
            </View>

            <View style={[styles.activityIcon, { backgroundColor: `${icon.color}20` }]}>
              <Icon  name={icon.name} size={20} color={icon.color}  />
            </View>

            {!activity.read && <View style={styles.unreadDot} />}
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0f172a',
  },
  loadingText: {
    color: '#9ca3af',
    fontSize: 16,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 80,
    paddingHorizontal: 32,
  },
  emptyTitle: {
    color: '#e2e8f0',
    fontSize: 20,
    fontWeight: '600',
    marginTop: 16,
    marginBottom: 8,
  },
  emptyText: {
    color: '#94a3b8',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  activityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
    backgroundColor: '#0f172a',
  },
  unreadActivity: {
    backgroundColor: '#1e293b',
  },
  actorAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    marginRight: 12,
    borderWidth: 2,
    borderColor: '#374151',
  },
  activityContent: {
    flex: 1,
    marginRight: 12,
  },
  activityText: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 2,
  },
  postTitle: {
    color: '#94a3b8',
    fontSize: 12,
    fontStyle: 'italic',
    marginBottom: 4,
  },
  activityTime: {
    color: '#6b7280',
    fontSize: 12,
  },
  activityIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  unreadDot: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#3b82f6',
  },

});

export default ActivityFeed;