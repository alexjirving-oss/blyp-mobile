import React, { useState, useEffect } from 'react';
import ScreenContainer from '../components/ScreenContainer';
import Icon from '../components/Icon';
import { ActivityIndicator, FlatList, Image, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { auth, firestore as db } from '../config/firebase';
import {
  collection,
  query,
  getDocs,
  doc,
  getDoc,
  onSnapshot,
  limit,
  startAfter,
  orderBy,
} from 'firebase/firestore';
import { followUser, unfollowUser } from '../utils/followUtils';
import { responsiveFont, responsiveSize } from '../utils/scaleUtils';

const FollowersScreen = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const { userId, type = 'followers' } = route.params; // 'followers' or 'following'
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMoreData, setHasMoreData] = useState(true);
  const [lastDoc, setLastDoc] = useState(null);
  const [followingList, setFollowingList] = useState(new Set());
  const currentUser = auth.currentUser;

  const ITEMS_PER_PAGE = 20;

  useEffect(() => {
    loadInitialUsers();
    if (currentUser) {
      loadCurrentUserFollowing();
    }
  }, [userId, type]);

  const loadInitialUsers = async () => {
    try {
      setLoading(true);
      setUsers([]);
      setLastDoc(null);
      setHasMoreData(true);
      await loadUsers(true);
    } catch (error) {
      console.error('Error loading initial users:', error);
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    try {
      setRefreshing(true);
      setUsers([]);
      setLastDoc(null);
      setHasMoreData(true);
      await loadUsers(true);
    } catch (error) {
      console.error('Error refreshing users:', error);
    } finally {
      setRefreshing(false);
    }
  };

  const loadUsers = async (isInitial = false) => {
    if (!hasMoreData && !isInitial) return;

    try {
      if (isInitial) {
        setLoading(true);
      } else {
        setLoadingMore(true);
      }

      const collectionName = type === 'followers' ? 'followers' : 'following';
      const usersRef = collection(db, 'users', userId, collectionName);

      let q = query(
        usersRef,
        orderBy('timestamp', 'desc'),
        limit(ITEMS_PER_PAGE)
      );

      if (!isInitial && lastDoc) {
        q = query(
          usersRef,
          orderBy('timestamp', 'desc'),
          startAfter(lastDoc),
          limit(ITEMS_PER_PAGE)
        );
      }

      const snapshot = await getDocs(q);

      if (snapshot.empty) {
        setHasMoreData(false);
        return;
      }

      // Batch fetch user data for better performance
      const userPromises = snapshot.docs.map(async (docSnap) => {
        const userDocRef = doc(db, 'users', docSnap.id);
        const userDoc = await getDoc(userDocRef);
        if (userDoc.exists()) {
          return {
            id: docSnap.id,
            ...userDoc.data()
          };
        }
        return null;
      });

      const userResults = await Promise.all(userPromises);
      const usersList = userResults.filter(user => user !== null);

      setLastDoc(snapshot.docs[snapshot.docs.length - 1]);

      if (isInitial) {
        setUsers(usersList);
      } else {
        setUsers(prevUsers => [...prevUsers, ...usersList]);
      }

      if (snapshot.docs.length < ITEMS_PER_PAGE) {
        setHasMoreData(false);
      }

    } catch (error) {
      console.error('Error loading users:', error);
    } finally {
      if (isInitial) {
        setLoading(false);
      } else {
        setLoadingMore(false);
      }
    }
  };

  const loadCurrentUserFollowing = () => {
    if (!currentUser) return;

    const followingRef = collection(db, 'users', currentUser.uid, 'following');
    return onSnapshot(followingRef, (snapshot) => {
      const following = new Set(snapshot.docs.map(doc => doc.id));
      setFollowingList(following);
    });
  };

  const handleFollowToggle = async (targetUserId) => {
    if (!currentUser) return;

    try {
      const isFollowing = followingList.has(targetUserId);
      const res = isFollowing
        ? await unfollowUser(currentUser.uid, targetUserId)
        : await followUser(currentUser.uid, targetUserId);
      if (!res?.success) {
        console.error('Error toggling follow:', res?.error?.message || res?.error);
      }
    } catch (error) {
      console.error('Error toggling follow:', error);
    }
  };

  const renderUserItem = ({ item }) => {
    const isCurrentUser = item.id === currentUser?.uid;
    const isFollowing = followingList.has(item.id);

    return (
      <View style={styles.userItem}>
        <TouchableOpacity
          style={styles.userInfo}
          onPress={() => {
            if (!isCurrentUser) {
              console.log('ðŸŽ¯ FollowersScreen: Navigating to user profile:', { userId: item.id, username: item.displayName || item.username });
              navigation.navigate('UserProfile', {
                userId: item.id,
                username: item.displayName || item.username || '@user'
              });
            }
          }}
        >
          <Image
            source={{
              uri: item.photoURL || item.avatar || 'https://via.placeholder.com/50'
            }}
            style={styles.avatar}
          />
          <View style={styles.userDetails}>
            <Text style={styles.username}>{item.displayName || item.username || 'Anonymous'}</Text>
            <Text style={styles.bio}>{item.bio || 'No bio available'}</Text>
          </View>
        </TouchableOpacity>

        {!isCurrentUser && (
          <TouchableOpacity
            style={[styles.followButton, isFollowing && styles.followingButton]}
            onPress={() => handleFollowToggle(item.id)}
          >
            <Text style={[styles.followButtonText, isFollowing && styles.followingButtonText]}>
              {isFollowing ? 'Following' : 'Follow'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <ScreenContainer>
      <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => navigation.goBack()}
            >
              <Icon name="arrow-back" size={24} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>
              {type === 'followers' ? 'Followers' : 'Following'}
            </Text>
            <View style={styles.placeholder} />
          </View>

          {/* Users List */}
          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#e74c3c" />
              <Text style={styles.loadingText}>Loading {type}...</Text>
            </View>
          ) : users.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Icon
                name={type === 'followers' ? 'people-outline' : 'person-add-outline'}
                size={64}
                color="#666"
              />
              <Text style={styles.emptyText}>
                {type === 'followers' ? 'No followers yet' : 'Not following anyone yet'}
              </Text>
            </View>
          ) : (
            <FlatList
              data={users}
              keyExtractor={(item) => item.id}
              renderItem={renderUserItem}
              contentContainerStyle={styles.listContainer}
              showsVerticalScrollIndicator={false}
              onEndReached={() => {
                if (hasMoreData && !loadingMore) {
                  loadUsers(false);
                }
              }}
              onEndReachedThreshold={0.5}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={handleRefresh}
                  tintColor="#e74c3c"
                  colors={['#e74c3c']}
                  progressBackgroundColor="#1a1a2e"
                />
              }
              ListFooterComponent={() => {
                if (loadingMore) {
                  return (
                    <View style={styles.loadingMoreContainer}>
                      <ActivityIndicator size="small" color="#e74c3c" />
                      <Text style={styles.loadingMoreText}>Loading more...</Text>
                    </View>
                  );
                }
                if (!hasMoreData && users.length > 0) {
                  return (
                    <View style={styles.endOfListContainer}>
                      <Text style={styles.endOfListText}>No more {type} to load</Text>
                    </View>
                  );
                }
                return null;
              }}
            />
          )}
      </View>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  gradient: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: responsiveFont(20),
    fontWeight: 'bold',
    color: '#fff',
  },
  placeholder: {
    width: 40,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: '#fff',
    marginTop: 8,
    fontSize: 16,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    color: '#666',
    fontSize: 16,
    marginTop: 8,
  },
  listContainer: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  userItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginRight: 12,
  },
  userDetails: {
    flex: 1,
  },
  username: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  bio: {
    color: '#999',
    fontSize: 14,
  },
  followButton: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#e74c3c',
    borderWidth: 1,
    borderColor: '#e74c3c',
  },
  followingButton: {
    backgroundColor: 'transparent',
    borderColor: '#666',
  },
  followButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  followingButtonText: {
    color: '#666',
  },
  loadingMoreContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  loadingMoreText: {
    color: '#fff',
    marginLeft: 10,
    fontSize: 14,
  },
  endOfListContainer: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  endOfListText: {
    color: '#666',
    fontSize: 14,
  },
});

export default FollowersScreen;


