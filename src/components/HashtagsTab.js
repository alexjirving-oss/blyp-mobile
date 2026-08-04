import React, { useState, useEffect } from 'react';
import Icon from './Icon';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Dimensions,
  RefreshControl,
  TextInput,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { smartListGenerator } from '../utils/smartListGenerator';
import { COLORS } from '../styles/theme';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

const HashtagsTab = ({ posts = [], userInteractions = [], onHashtagSelect, navigation }) => {
  const [hashtagCategories, setHashtagCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedHashtags, setSelectedHashtags] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredPosts, setFilteredPosts] = useState([]);

  useEffect(() => {
    // Only reload if we don't have hashtags or posts changed significantly
    if (hashtagCategories.length === 0 && posts.length > 0) {
      loadHashtags();
    }
  }, [posts.length]); // Only depend on posts count, not full posts array

  const loadHashtags = async () => {
    try {
      setLoading(true);
      console.log('ðŸ·ï¸ Loading smart hashtags...');

      // Generate AI-powered hashtag recommendations
      const aiHashtags = await smartListGenerator.generateHashtags(posts, userInteractions);
      setHashtagCategories(aiHashtags);

      console.log('âœ… Hashtag categories loaded:', aiHashtags.length);
    } catch (error) {
      console.error('âŒ Error loading hashtags:', error);
      // Load fallback hashtags
      setHashtagCategories(smartListGenerator.getFallbackHashtags());
    } finally {
      setLoading(false);
    }
  };

  const handleHashtagPress = (hashtag) => {
    try {
      console.log('ðŸ·ï¸ Selected hashtag:', hashtag);

      let newSelectedHashtags;
      if (selectedHashtags.includes(hashtag)) {
        // Remove if already selected
        newSelectedHashtags = selectedHashtags.filter(tag => tag !== hashtag);
      } else {
        // Add to selection (max 5 hashtags)
        newSelectedHashtags = [...selectedHashtags, hashtag].slice(-5);
      }

      setSelectedHashtags(newSelectedHashtags);

      // Filter posts by selected hashtags
      if (newSelectedHashtags.length > 0) {
        const filtered = posts.filter(post => {
          return newSelectedHashtags.some(tag =>
            smartListGenerator.filterPostsByHashtag([post], tag).length > 0
          );
        });
        setFilteredPosts(filtered);
      } else {
        setFilteredPosts([]);
      }

      // Call parent callback if provided
      if (onHashtagSelect) {
        onHashtagSelect(newSelectedHashtags, filteredPosts);
      }
    } catch (error) {
      console.error('âŒ Hashtag selection error:', error);
    }
  };

  const renderHashtagCategory = ({ item: category }) => (
    <View style={styles.hashtagCategory}>
      <View style={styles.categoryHeader}>
        <Text style={styles.categoryTitle}>{category.name}</Text>
        <Text style={styles.categoryDescription}>{category.description}</Text>
      </View>

      <View style={styles.hashtagGrid}>
        {category.hashtags.map((hashtag, index) => (
          <TouchableOpacity
            key={`${category.id}-${index}`}
            style={[
              styles.hashtagChip,
              selectedHashtags.includes(hashtag) && styles.selectedHashtagChip,
              { borderColor: category.color }
            ]}
            onPress={() => handleHashtagPress(hashtag)}
            activeOpacity={0.7}
          >
            <Text style={[
              styles.hashtagText,
              selectedHashtags.includes(hashtag) && styles.selectedHashtagText
            ]}>
              {hashtag}
            </Text>
            {selectedHashtags.includes(hashtag) && (
              <Icon name="checkmark" size={14} color="#fff" style={styles.checkIcon} />
            )}
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  const renderHeader = () => (
    <View style={styles.header}>
      <Text style={styles.headerTitle}>Smart Hashtags</Text>
      <Text style={styles.headerSubtitle}>
        AI-curated hashtag recommendations for maximum reach
      </Text>

      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <Icon name="search" size={20} color="#9ca3af" style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search hashtags..."
          placeholderTextColor="#9ca3af"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      {/* Selected Hashtags */}
      {selectedHashtags.length > 0 && (
        <View style={styles.selectedContainer}>
          <View style={styles.selectedHeader}>
            <Text style={styles.selectedTitle}>Selected ({selectedHashtags.length}/5)</Text>
            <TouchableOpacity onPress={() => setSelectedHashtags([])}>
              <Text style={styles.clearAllButton}>Clear All</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.selectedHashtags}>
            {selectedHashtags.map((hashtag, index) => (
              <LinearGradient
                key={index}
                colors={['#00D2BE', '#00A89E']}
                style={styles.selectedHashtagChip}
              >
                <Text style={styles.selectedHashtagText}>{hashtag}</Text>
                <TouchableOpacity onPress={() => handleHashtagPress(hashtag)}>
                  <Icon name="close" size={14} color="#0A0A0C" />
                </TouchableOpacity>
              </LinearGradient>
            ))}
          </View>

          <Text style={styles.matchingPosts}>
            {filteredPosts.length} matching posts
          </Text>
        </View>
      )}
    </View>
  );

  // Filter categories based on search
  const filteredCategories = hashtagCategories.filter(category => {
    if (!searchQuery) return true;

    const query = searchQuery.toLowerCase();
    return (
      category.name.toLowerCase().includes(query) ||
      category.hashtags.some(hashtag =>
        hashtag.toLowerCase().includes(query)
      )
    );
  });

  // Leaderboard-style placeholder body for Hashtags (EXACT PARITY)
  return (
    <View style={[styles.container, { backgroundColor: '#141418' }]}>
      <View style={styles.comingSoon}>
        <Icon name="pricetag" size={64} color="#fff" />
        <Text style={styles.comingSoonTitle}>Hashtags</Text>
        <Text style={styles.comingSoonText}>
          Smart hashtag suggestions coming soon!
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  subtitle: {
    color: '#fff',
    fontSize: 15,
    marginTop: 8,
    textAlign: 'center',
    opacity: 0.7,
  },
  container: {
    flex: 1,
    backgroundColor: COLORS.pageBackground,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.pageBackground,
  },
  comingSoon: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  comingSoonTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginTop: 24,
    marginBottom: 8,
    textAlign: 'center',
  },
  comingSoonText: {
    fontSize: 16,
    color: '#e5e7eb',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 30,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#141418',
    borderRadius: 25,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 20,
  },
  searchIcon: {
    marginRight: 12,
  },
  searchInput: {
    flex: 1,
    color: '#fff',
    fontSize: 16,
  },
  selectedContainer: {
    backgroundColor: 'rgba(203,251,69,0.1)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
  },
  selectedHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  selectedTitle: {
    color: '#F5F5F7',
    fontSize: 16,
    fontWeight: '700',
  },
  clearAllButton: {
    color: '#00D2BE',
    fontSize: 14,
    fontWeight: '600',
  },
  selectedHashtags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 8,
  },
  selectedHashtagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    marginRight: 8,
    marginBottom: 8,
  },
  selectedHashtagText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginRight: 8,
  },
  matchingPosts: {
    color: '#9ca3af',
    fontSize: 12,
    textAlign: 'center',
  },
  listContent: {
    paddingTop: 8,
    paddingBottom: 100,
  },
  hashtagCategory: {
    marginBottom: 32,
    paddingHorizontal: 20,
  },
  categoryHeader: {
    marginBottom: 16,
  },
  categoryTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 4,
  },
  categoryDescription: {
    fontSize: 14,
    color: '#9ca3af',
  },
  hashtagGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  hashtagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#141418',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 8,
    marginBottom: 8,
  },
  selectedHashtagChip: {
    backgroundColor: '#00D2BE',
    borderColor: '#00D2BE',
  },
  hashtagText: {
    color: '#A1A1AA',
    fontSize: 14,
    fontWeight: '600',
  },
  selectedHashtagText: {
    color: '#0A0A0C',
    fontWeight: '700',
  },
  checkIcon: {
    marginLeft: 6,
  },
});

export default HashtagsTab;
