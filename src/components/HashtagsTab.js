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
      console.log('🏷️ Loading smart hashtags...');
      
      // Generate AI-powered hashtag recommendations
      const aiHashtags = await smartListGenerator.generateHashtags(posts, userInteractions);
      setHashtagCategories(aiHashtags);
      
      console.log('✅ Hashtag categories loaded:', aiHashtags.length);
    } catch (error) {
      console.error('❌ Error loading hashtags:', error);
      // Load fallback hashtags
      setHashtagCategories(smartListGenerator.getFallbackHashtags());
    } finally {
      setLoading(false);
    }
  };

  const handleHashtagPress = (hashtag) => {
    try {
      console.log('🏷️ Selected hashtag:', hashtag);
      
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
      console.error('❌ Hashtag selection error:', error);
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
              <Icon  name="checkmark" size={14} color="#fff" style={styles.checkIcon}  />
            )}
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  const renderHeader = () => (
    <View style={styles.header}>
      <Text style={styles.headerTitle}>🏷️ Smart Hashtags</Text>
      <Text style={styles.headerSubtitle}>
        AI-curated hashtag recommendations for maximum reach
      </Text>
      
      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <Icon  name="search" size={20} color="#9ca3af" style={styles.searchIcon}  />
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
                colors={['#8b5cf6', '#ec4899']}
                style={styles.selectedHashtagChip}
              >
                <Text style={styles.selectedHashtagText}>{hashtag}</Text>
                <TouchableOpacity onPress={() => handleHashtagPress(hashtag)}>
                  <Icon  name="close" size={14} color="#fff"  />
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

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <Icon  name="pricetag" size={48} color="#8b5cf6"  />
        <Text style={styles.loadingText}>Generating smart hashtags...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={filteredCategories}
        renderItem={renderHashtagCategory}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={renderHeader}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={loadHashtags}
            colors={['#8b5cf6']}
            tintColor="#8b5cf6"
          />
        }
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
  },
  loadingText: {
    color: '#8b5cf6',
    fontSize: 16,
    marginTop: 16,
    textAlign: 'center',
  },
  header: {
    padding: 20,
    paddingTop: 60, // Account for status bar
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
  },
  headerSubtitle: {
    fontSize: 16,
    color: '#9ca3af',
    marginBottom: 20,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1f2937',
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
    backgroundColor: 'rgba(139,92,246,0.1)',
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
    color: '#8b5cf6',
    fontSize: 16,
    fontWeight: '600',
  },
  clearAllButton: {
    color: '#ec4899',
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
    backgroundColor: '#1f2937',
    borderWidth: 1,
    borderColor: '#374151',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 8,
    marginBottom: 8,
  },
  selectedHashtagChip: {
    backgroundColor: '#8b5cf6',
    borderColor: '#8b5cf6',
  },
  hashtagText: {
    color: '#9ca3af',
    fontSize: 14,
    fontWeight: '600',
  },
  selectedHashtagText: {
    color: '#fff',
  },
  checkIcon: {
    marginLeft: 6,
  },
});

export default HashtagsTab;