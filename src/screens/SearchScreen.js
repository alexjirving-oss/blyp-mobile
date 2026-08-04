import React, { useState, useEffect, useRef } from 'react';
import BlueScreen from '../ui/BlueScreen';
import Icon from '../components/Icon';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Image,
  FlatList,
  ActivityIndicator,
  Dimensions
} from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import { LinearGradient } from 'expo-linear-gradient';
import searchService from '../services/searchService';
import { COLORS } from '../styles/theme';

const { width: screenWidth } = Dimensions.get('window');

const SearchScreen = ({ navigation }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedTab, setSelectedTab] = useState('all');
  const [suggestions, setSuggestions] = useState(null);
  const searchInputRef = useRef(null);

  // Search tabs
  const searchTabs = [
    { id: 'all', label: 'All', icon: 'search-outline' },
    { id: 'users', label: 'Users', icon: 'people-outline' },
    { id: 'posts', label: 'Posts', icon: 'grid-outline' },
    { id: 'hashtags', label: 'Tags', icon: 'pricetag-outline' },
    { id: 'locations', label: 'Places', icon: 'location-outline' }
  ];

  useEffect(() => {
    // Load initial suggestions
    loadSuggestions();
  }, []);

  useEffect(() => {
    if (searchQuery.length >= 2) {
      performSearch();
    } else if (searchQuery.length === 0) {
      setSearchResults(null);
      loadSuggestions();
    }
  }, [searchQuery, selectedTab]);

  const loadSuggestions = async () => {
    try {
      const suggestions = searchService.getSearchSuggestions();
      setSuggestions(suggestions);
    } catch (error) {
      console.error('❌ Error loading suggestions:', error);
    }
  };

  const performSearch = async () => {
    if (!searchQuery.trim()) return;

    setIsLoading(true);
    try {
      const results = await searchService.globalSearch(searchQuery, {
        type: selectedTab === 'all' ? null : selectedTab,
        limit: 20
      });
      setSearchResults(results);
    } catch (error) {
      console.error('❌ Search error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClearSearch = () => {
    setSearchQuery('');
    setSearchResults(null);
    loadSuggestions();
    searchInputRef.current?.blur();
  };

  const handleSuggestionPress = (suggestion) => {
    setSearchQuery(suggestion);
    performSearch();
  };

  const navigateToResults = (query, type = 'all') => {
    navigation.navigate('SearchResults', { query, type });
  };

  const renderSearchInput = () => (
    <View style={styles.searchContainer}>
      <View style={styles.searchInputContainer}>
        <Icon name="search" size={20} color="#666" style={styles.searchIcon} />
        <TextInput
          ref={searchInputRef}
          style={styles.searchInput}
          placeholder="Search for users, posts, hashtags..."
          placeholderTextColor="#666"
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          onSubmitEditing={performSearch}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={handleClearSearch} style={styles.clearButton}>
            <Icon name="close-circle" size={20} color="#666" />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );

  const renderSearchTabs = () => (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.tabsContainer}
      contentContainerStyle={styles.tabsContent}
    >
      {searchTabs.map((tab) => (
        <TouchableOpacity
          key={tab.id}
          style={[
            styles.tab,
            selectedTab === tab.id && styles.activeTab
          ]}
          onPress={() => setSelectedTab(tab.id)}
        >
          <Icon
            name={tab.icon}
            size={16}
            color={selectedTab === tab.id ? '#fff' : '#666'}
          />
          <Text style={[
            styles.tabText,
            selectedTab === tab.id && styles.activeTabText
          ]}>
            {tab.label}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );

  const renderUserItem = ({ item }) => (
    <TouchableOpacity
      style={styles.userItem}
      onPress={() => navigateToResults(item.username, 'users')}
    >
      <Image source={{ uri: item.avatar }} style={styles.userAvatar} />
      <View style={styles.userInfo}>
        <View style={styles.userNameRow}>
          <Text style={styles.username}>@{item.username}</Text>
          {item.verified && (
            <Icon name="checkmark-circle" size={16} color="#1da1f2" />
          )}
        </View>
        <Text style={styles.displayName}>{item.displayName}</Text>
        <Text style={styles.followers}>{item.followers} followers</Text>
      </View>
      <TouchableOpacity style={styles.followButton}>
        <Text style={styles.followButtonText}>Follow</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );

  const renderPostItem = ({ item, index }) => (
    <TouchableOpacity
      style={[styles.postItem, { width: screenWidth / 3 - 4 }]}
      onPress={() => navigation.navigate('Blyp', { initialQuery: searchQuery })}
    >
      <Image source={{ uri: item.thumbnail }} style={styles.postThumbnail} />
      {item.type === 'video' && (
        <View style={styles.videoIndicator}>
          <Icon name="play" size={16} color="#fff" />
        </View>
      )}
      <View style={styles.postStats}>
        <View style={styles.postStat}>
          <Icon name="heart" size={12} color="#fff" />
          <Text style={styles.postStatText}>{item.likes}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  const renderHashtagItem = ({ item }) => (
    <TouchableOpacity
      style={styles.hashtagItem}
      onPress={() => navigation.navigate('Blyp', { initialQuery: item.hashtag })}
    >
      <View style={styles.hashtagIcon}>
        <Icon name="pricetag" size={24} color="#00D2BE" />
      </View>
      <View style={styles.hashtagInfo}>
        <Text style={styles.hashtagText}>{item.hashtag}</Text>
        <Text style={styles.hashtagCount}>
          {item.postCount.toLocaleString()} posts
        </Text>
      </View>
      {item.trending && (
        <View style={styles.trendingBadge}>
          <Text style={styles.trendingText}>Trending</Text>
        </View>
      )}
    </TouchableOpacity>
  );

  const renderLocationItem = ({ item }) => (
    <TouchableOpacity
      style={styles.locationItem}
      onPress={() => navigation.navigate('Blyp', { initialQuery: item.name })}
    >
      <View style={styles.locationIcon}>
        <Icon name="location" size={24} color="#10b981" />
      </View>
      <View style={styles.locationInfo}>
        <Text style={styles.locationName}>{item.name}</Text>
        <Text style={styles.locationCount}>
          {item.postCount.toLocaleString()} posts
        </Text>
      </View>
    </TouchableOpacity>
  );

  const renderSuggestions = () => (
    <ScrollView style={styles.suggestionsContainer}>
      {/* Recent Searches */}
      {suggestions?.recent && suggestions.recent.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recent</Text>
          {suggestions.recent.map((item, index) => (
            <TouchableOpacity
              key={index}
              style={styles.suggestionItem}
              onPress={() => handleSuggestionPress(item)}
            >
              <Icon name="time-outline" size={16} color="#666" />
              <Text style={styles.suggestionText}>{item}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Trending */}
      {suggestions?.trending && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Trending</Text>
          {suggestions.trending.map((item, index) => (
            <TouchableOpacity
              key={index}
              style={styles.suggestionItem}
              onPress={() => handleSuggestionPress(item)}
            >
              <Icon name="trending-up" size={16} color="#00D2BE" />
              <Text style={styles.suggestionText}>{item}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Suggested Users */}
      {suggestions?.users && suggestions.users.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Suggested Users</Text>
          <FlatList
            data={suggestions.users}
            renderItem={renderUserItem}
            keyExtractor={(item) => item.id}
            scrollEnabled={false}
          />
        </View>
      )}

      {/* Trending Hashtags */}
      {suggestions?.hashtags && suggestions.hashtags.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Trending Hashtags</Text>
          <FlatList
            data={suggestions.hashtags}
            renderItem={renderHashtagItem}
            keyExtractor={(item) => item.hashtag}
            scrollEnabled={false}
          />
        </View>
      )}
    </ScrollView>
  );

  const renderSearchResults = () => {
    if (isLoading) {
      return (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#00D2BE" />
          <Text style={styles.loadingText}>Searching...</Text>
        </View>
      );
    }

    if (!searchResults) return null;

    const getResultsForTab = () => {
      switch (selectedTab) {
        case 'users':
          return searchResults.users || [];
        case 'posts':
          return searchResults.posts || [];
        case 'hashtags':
          return searchResults.hashtags || [];
        case 'locations':
          return searchResults.locations || [];
        default:
          return {
            users: searchResults.users || [],
            posts: searchResults.posts || [],
            hashtags: searchResults.hashtags || [],
            locations: searchResults.locations || []
          };
      }
    };

    const results = getResultsForTab();

    if (selectedTab === 'all') {
      return (
        <ScrollView style={styles.resultsContainer}>
          {results.users.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>Users</Text>
                <TouchableOpacity onPress={() => navigateToResults(searchQuery, 'users')}>
                  <Text style={styles.viewAllButton}>View All</Text>
                </TouchableOpacity>
              </View>
              <FlatList
                data={results.users.slice(0, 3)}
                renderItem={renderUserItem}
                keyExtractor={(item) => item.id}
                scrollEnabled={false}
              />
            </View>
          )}

          {results.posts.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>Posts</Text>
                <TouchableOpacity onPress={() => navigateToResults(searchQuery, 'posts')}>
                  <Text style={styles.viewAllButton}>View All</Text>
                </TouchableOpacity>
              </View>
              <FlatList
                data={results.posts.slice(0, 6)}
                renderItem={renderPostItem}
                keyExtractor={(item) => item.id}
                numColumns={3}
                scrollEnabled={false}
              />
            </View>
          )}

          {results.hashtags.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>Hashtags</Text>
                <TouchableOpacity onPress={() => navigateToResults(searchQuery, 'hashtags')}>
                  <Text style={styles.viewAllButton}>View All</Text>
                </TouchableOpacity>
              </View>
              <FlatList
                data={results.hashtags.slice(0, 3)}
                renderItem={renderHashtagItem}
                keyExtractor={(item) => item.hashtag}
                scrollEnabled={false}
              />
            </View>
          )}

          {results.locations.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>Locations</Text>
                <TouchableOpacity onPress={() => navigateToResults(searchQuery, 'locations')}>
                  <Text style={styles.viewAllButton}>View All</Text>
                </TouchableOpacity>
              </View>
              <FlatList
                data={results.locations.slice(0, 3)}
                renderItem={renderLocationItem}
                keyExtractor={(item) => item.id}
                scrollEnabled={false}
              />
            </View>
          )}
        </ScrollView>
      );
    }

    // Single category results
    const renderItemForTab = () => {
      switch (selectedTab) {
        case 'users':
          return renderUserItem;
        case 'posts':
          return renderPostItem;
        case 'hashtags':
          return renderHashtagItem;
        case 'locations':
          return renderLocationItem;
        default:
          return null;
      }
    };

    return (
      <FlatList
        style={styles.resultsContainer}
        data={results}
        renderItem={renderItemForTab()}
        keyExtractor={(item) => item.id || item.hashtag || item.name}
        numColumns={selectedTab === 'posts' ? 3 : 1}
        showsVerticalScrollIndicator={false}
      />
    );
  };

  return (
    <BlueScreen>
      <ScreenContainer>
        <LinearGradient colors={[COLORS.pageBackground, COLORS.backgroundLight]} style={styles.container}>
          {renderSearchInput()}
          {renderSearchTabs()}

          {searchQuery.length >= 2 ? renderSearchResults() : renderSuggestions()}
        </LinearGradient>
      </ScreenContainer>
    </BlueScreen>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  searchContainer: {
    padding: 16,
  },
  searchInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2a2a2a',
    borderRadius: 25,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  searchIcon: {
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    color: '#fff',
    fontSize: 16,
  },
  clearButton: {
    marginLeft: 10,
  },
  tabsContainer: {
    maxHeight: 50,
  },
  tabsContent: {
    paddingHorizontal: 16,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginRight: 12,
    borderRadius: 20,
    backgroundColor: '#2a2a2a',
  },
  activeTab: {
    backgroundColor: '#00D2BE',
  },
  tabText: {
    color: '#666',
    marginLeft: 6,
    fontSize: 14,
    fontWeight: '600',
  },
  activeTabText: {
    color: '#0A0A0C',
    fontWeight: '700',
  },
  suggestionsContainer: {
    flex: 1,
    padding: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
  },
  viewAllButton: {
    fontSize: 14,
    color: '#00D2BE',
    fontWeight: '600',
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  suggestionText: {
    color: '#ccc',
    marginLeft: 12,
    fontSize: 16,
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
    backgroundColor: '#00D2BE',
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
    borderRadius: 12,
    padding: 4,
  },
  postStats: {
    position: 'absolute',
    bottom: 8,
    left: 8,
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
    backgroundColor: '#2a2a2a',
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
  trendingBadge: {
    backgroundColor: '#00D2BE',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  trendingText: {
    color: '#0A0A0C',
    fontSize: 12,
    fontWeight: '700',
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
    backgroundColor: '#2a2a2a',
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
  resultsContainer: {
    flex: 1,
    padding: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#ccc',
    marginTop: 8,
    fontSize: 16,
  },
});

export default SearchScreen;

