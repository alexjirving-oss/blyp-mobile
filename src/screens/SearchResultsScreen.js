import React, { useState, useEffect } from 'react';
import Icon from '../components/Icon';
import ScreenContainer from '../components/ScreenContainer';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  ScrollView,
  ActivityIndicator,
  Dimensions
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import searchService from '../services/searchService';
import { responsiveFont, responsiveSize } from '../utils/scaleUtils';

const { width: screenWidth } = Dimensions.get('window');

const SearchResultsScreen = ({ route, navigation }) => {
  const { query, type = 'all' } = route.params;
  const [results, setResults] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    performSearch();
  }, [query, type]);

  const performSearch = async () => {
    try {
      setIsLoading(true);
      const searchResults = await searchService.globalSearch(query, {
        type: type === 'all' ? null : type,
        limit: 50
      });
      setResults(searchResults);
    } catch (error) {
      console.error('❌ Search error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const renderUserItem = ({ item }) => (
    <TouchableOpacity 
      style={styles.userItem}
      onPress={() => navigation.navigate('UserProfile', { userId: item.id, username: item.username })}
    >
      <Image source={{ uri: item.avatar }} style={styles.userAvatar} />
      <View style={styles.userInfo}>
        <View style={styles.userNameRow}>
          <Text style={styles.username}>@{item.username}</Text>
          {item.verified && (
            <Icon  name="checkmark-circle" size={16} color="#1da1f2"  />
          )}
        </View>
        <Text style={styles.displayName}>{item.displayName}</Text>
        <Text style={styles.followers}>{item.followers} followers</Text>
      </View>
      <TouchableOpacity style={styles.followButton}>
        <LinearGradient
          colors={['#00D2BE', '#00A89E']}
          style={styles.followGradient}
        >
          <Text style={styles.followButtonText}>Follow</Text>
        </LinearGradient>
      </TouchableOpacity>
    </TouchableOpacity>
  );

  const renderPostItem = ({ item, index }) => (
    <TouchableOpacity 
      style={[styles.postItem, { width: screenWidth / 3 - 4 }]}
      onPress={() => navigation.navigate('Blyp', { initialQuery: query })}
    >
      <Image source={{ uri: item.thumbnail }} style={styles.postThumbnail} />
      {item.type === 'video' && (
        <View style={styles.videoIndicator}>
          <Icon  name="play" size={20} color="#fff"  />
        </View>
      )}
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.8)']}
        style={styles.postOverlay}
      >
        <View style={styles.postStats}>
          <View style={styles.postStat}>
            <Icon  name="heart" size={14} color="#fff"  />
            <Text style={styles.postStatText}>{item.likes}</Text>
          </View>
          <View style={styles.postStat}>
            <Icon  name="chatbubble" size={14} color="#fff"  />
            <Text style={styles.postStatText}>{item.comments}</Text>
          </View>
        </View>
      </LinearGradient>
    </TouchableOpacity>
  );

  const renderHashtagItem = ({ item }) => (
    <TouchableOpacity 
      style={styles.hashtagItem}
      onPress={() => navigation.navigate('Blyp', { initialQuery: item.hashtag })}
    >
      <LinearGradient
        colors={['#00D2BE', '#00A89E']}
        style={styles.hashtagIcon}
      >
        <Icon  name="pricetag" size={24} color="#0A0A0C"  />
      </LinearGradient>
      <View style={styles.hashtagInfo}>
        <Text style={styles.hashtagText}>{item.hashtag}</Text>
        <Text style={styles.hashtagCount}>
          {item.postCount.toLocaleString()} posts
        </Text>
        {item.trending && (
          <View style={styles.trendingIndicator}>
            <Icon  name="trending-up" size={12} color="#00D2BE"  />
            <Text style={styles.trendingText}>Trending</Text>
          </View>
        )}
      </View>
      <Icon  name="chevron-forward" size={20} color="#666"  />
    </TouchableOpacity>
  );

  const renderLocationItem = ({ item }) => (
    <TouchableOpacity 
      style={styles.locationItem}
      onPress={() => navigation.navigate('Blyp', { initialQuery: item.name })}
    >
      <LinearGradient
        colors={['#10b981', '#059669']}
        style={styles.locationIcon}
      >
        <Icon  name="location" size={24} color="#fff"  />
      </LinearGradient>
      <View style={styles.locationInfo}>
        <Text style={styles.locationName}>{item.name}</Text>
        <Text style={styles.locationCount}>
          {item.postCount.toLocaleString()} posts
        </Text>
      </View>
      <Icon  name="chevron-forward" size={20} color="#666"  />
    </TouchableOpacity>
  );

  const renderEmptyState = () => (
    <View style={styles.emptyContainer}>
      <Icon  name="search" size={64} color="#666"  />
      <Text style={styles.emptyTitle}>No results found</Text>
      <Text style={styles.emptyText}>
        Try adjusting your search terms or browsing different categories
      </Text>
    </View>
  );

  const getResultCount = () => {
    if (!results) return 0;
    
    if (type === 'all') {
      return (results.users?.length || 0) + 
             (results.posts?.length || 0) + 
             (results.hashtags?.length || 0) + 
             (results.locations?.length || 0);
    }
    
    return results[type]?.length || 0;
  };

  if (isLoading) {
    return (
      <ScreenContainer noSafeArea={true} style={{ paddingTop: 0 }}>
        <View style={styles.header}>
          <TouchableOpacity 
            style={styles.backButton}
            onPress={() => navigation.goBack()}
          >
            <Icon  name="arrow-back" size={24} color="#fff"  />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Search Results</Text>
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#00D2BE" />
          <Text style={styles.loadingText}>Searching for "{query}"...</Text>
        </View>
      </ScreenContainer>
    );
  }

  const resultCount = getResultCount();

  return (
    <ScreenContainer noSafeArea={true} style={{ paddingTop: 0 }}>
      <View style={styles.header}>
        <TouchableOpacity 
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Icon  name="arrow-back" size={24} color="#fff"  />
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.headerTitle}>Search Results</Text>
          <Text style={styles.headerSubtitle}>
            {resultCount} results for "{query}"
          </Text>
        </View>
      </View>

      {resultCount === 0 ? (
        renderEmptyState()
      ) : (
        <ScrollView style={styles.content}>
          {/* Users Section */}
          {results?.users && results.users.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Icon  name="people" size={20} color="#00D2BE"  />
                <Text style={styles.sectionTitle}>Users ({results.users.length})</Text>
              </View>
              <FlatList
                data={results.users}
                renderItem={renderUserItem}
                keyExtractor={(item) => item.id}
                scrollEnabled={false}
              />
            </View>
          )}

          {/* Posts Section */}
          {results?.posts && results.posts.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Icon  name="grid" size={20} color="#00D2BE"  />
                <Text style={styles.sectionTitle}>Posts ({results.posts.length})</Text>
              </View>
              <FlatList
                data={results.posts}
                renderItem={renderPostItem}
                keyExtractor={(item) => item.id}
                numColumns={3}
                scrollEnabled={false}
              />
            </View>
          )}

          {/* Hashtags Section */}
          {results?.hashtags && results.hashtags.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Icon  name="pricetag" size={20} color="#00D2BE"  />
                <Text style={styles.sectionTitle}>Hashtags ({results.hashtags.length})</Text>
              </View>
              <FlatList
                data={results.hashtags}
                renderItem={renderHashtagItem}
                keyExtractor={(item) => item.hashtag}
                scrollEnabled={false}
              />
            </View>
          )}

          {/* Locations Section */}
          {results?.locations && results.locations.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Icon  name="location" size={20} color="#00D2BE"  />
                <Text style={styles.sectionTitle}>Locations ({results.locations.length})</Text>
              </View>
              <FlatList
                data={results.locations}
                renderItem={renderLocationItem}
                keyExtractor={(item) => item.id}
                scrollEnabled={false}
              />
            </View>
          )}
        </ScrollView>
      )}
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    paddingTop: 60,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
  },
  backButton: {
    padding: 8,
    marginRight: 16,
  },
  headerInfo: {
    flex: 1,
  },
  headerTitle: {
    fontSize: responsiveFont(20),
    fontWeight: 'bold',
    color: '#fff',
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#666',
    marginTop: 2,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    marginLeft: 8,
  },
  userItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
  },
  userAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginRight: 12,
  },
  userInfo: {
    flex: 1,
  },
  userNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  username: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#fff',
    marginRight: 6,
  },
  displayName: {
    fontSize: 14,
    color: '#ccc',
    marginTop: 2,
  },
  followers: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  followButton: {
    borderRadius: 15,
  },
  followGradient: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 15,
  },
  followButtonText: {
    color: '#0A0A0C',
    fontSize: 14,
    fontWeight: '700',
  },
  postItem: {
    margin: 1,
    aspectRatio: 1,
    position: 'relative',
  },
  postThumbnail: {
    width: '100%',
    height: '100%',
    borderRadius: 4,
  },
  videoIndicator: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 15,
    padding: 6,
  },
  postOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 8,
  },
  postStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  postStat: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  postStatText: {
    color: '#fff',
    fontSize: 12,
    marginLeft: 4,
  },
  hashtagItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
  },
  hashtagIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  hashtagInfo: {
    flex: 1,
  },
  hashtagText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#fff',
  },
  hashtagCount: {
    fontSize: 14,
    color: '#666',
    marginTop: 2,
  },
  trendingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  trendingText: {
    fontSize: 12,
    color: '#00D2BE',
    marginLeft: 4,
    fontWeight: '600',
  },
  locationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
  },
  locationIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  locationInfo: {
    flex: 1,
  },
  locationName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#fff',
  },
  locationCount: {
    fontSize: 14,
    color: '#666',
    marginTop: 2,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginTop: 16,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    lineHeight: 24,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#ccc',
    marginTop: 16,
    fontSize: 16,
  },
});

export default SearchResultsScreen;