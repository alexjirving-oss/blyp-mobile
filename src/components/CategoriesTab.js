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
  PixelRatio,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { smartListGenerator } from '../utils/smartListGenerator';
import { responsiveFont } from '../utils/scaleUtils';
import { COLORS } from '../styles/theme';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
const fontScale = PixelRatio.getFontScale();
const pixelRatio = PixelRatio.get();



// More aggressive responsive spacing for high-scaling devices
const responsiveSize = (size) => {
  const isHighScaling = fontScale > 1.15 || pixelRatio > 3;

  if (isHighScaling) {
    // Reduce spacing significantly on high-scaling devices
    return size * 0.8;
  }

  const scale = Math.min(screenWidth / 375, 1.15); // Tighter limit
  return size * scale;
};

const CategoriesTab = ({ posts = [], onCategorySelect, navigation }) => {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [filteredPosts, setFilteredPosts] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredCategories, setFilteredCategories] = useState([]);

  useEffect(() => {
    // Only reload if we don't have categories or posts changed significantly
    if (categories.length === 0 && posts.length > 0) {
      loadCategories();
    }
  }, [posts.length]); // Only depend on posts count, not full posts array

  useEffect(() => {
    // Filter categories based on search query
    const filtered = categories.filter(category =>
      category.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      category.description.toLowerCase().includes(searchQuery.toLowerCase())
    );
    setFilteredCategories(filtered);
  }, [categories, searchQuery]);

  const loadCategories = async () => {
    try {
      setLoading(true);
      console.log('ðŸ“‚ Loading smart categories...');

      // Generate AI-powered categories
      const aiCategories = await smartListGenerator.generateCategories(posts);
      setCategories(aiCategories);

      console.log('âœ… Categories loaded:', aiCategories.length);
    } catch (error) {
      console.error('âŒ Error loading categories:', error);
      // Load fallback categories
      setCategories(smartListGenerator.getFallbackCategories());
    } finally {
      setLoading(false);
    }
  };

  const handleCategoryPress = async (category) => {
    try {
      console.log('ðŸ“‚ Filtering posts by category:', category.name);
      setSelectedCategory(category);

      // Filter posts by selected category
      const filtered = await smartListGenerator.filterPostsByCategory(posts, category);
      setFilteredPosts(filtered);

      // Call parent callback if provided
      if (onCategorySelect) {
        onCategorySelect(category, filtered);
      }
    } catch (error) {
      console.error('âŒ Category selection error:', error);
    }
  };

  const renderCategoryItem = ({ item: category }) => (
    <TouchableOpacity
      style={[
        styles.categoryCard,
        selectedCategory?.id === category.id && styles.selectedCategoryCard
      ]}
      onPress={() => handleCategoryPress(category)}
      activeOpacity={0.8}
    >
      <LinearGradient
        colors={[category.color || '#00D2BE', `${category.color || '#00D2BE'}90`]}
        style={styles.categoryGradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <View style={styles.categoryHeader}>
          <Icon
            name={category.icon || 'apps'}
            size={responsiveSize(20)}
            color="#fff"
          />
          <Text style={styles.categoryTitle} numberOfLines={1} adjustsFontSizeToFit={true} minimumFontScale={0.6}>
            {category.name}
          </Text>
        </View>

        <Text style={styles.categoryDescription} numberOfLines={2}>
          {category.description}
        </Text>

        <View style={styles.categoryFooter}>
          <Text style={styles.categoryStats}>
            {Math.floor(Math.random() * 500 + 100)} posts
          </Text>
          <Icon name="chevron-forward" size={16} color="#ffffff90" />
        </View>
      </LinearGradient>
    </TouchableOpacity>
  );

  const renderHeader = () => (
    <View style={styles.header}>
      <Text style={styles.headerTitle}>Smart Categories</Text>
      <Text style={styles.headerSubtitle}>
        AI-curated content categories for easy discovery
      </Text>

      {/* Search Input */}
      <View style={styles.searchContainer}>
        <View style={styles.searchInputContainer}>
          <Icon name="search" size={16} color="#666" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search categories..."
            placeholderTextColor="#666"
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity
              onPress={() => setSearchQuery('')}
              style={styles.clearSearchButton}
            >
              <Icon name="close-circle" size={16} color="#666" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {selectedCategory && (
        <TouchableOpacity
          style={styles.clearButton}
          onPress={() => {
            setSelectedCategory(null);
            setFilteredPosts([]);
          }}
        >
          <Icon name="close-circle" size={20} color="#A1A1AA" />
          <Text style={styles.clearButtonText}>Clear Filter</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  // Leaderboard-style placeholder body for Categories (EXACT PARITY)
  return (
    <View style={[styles.container, { backgroundColor: '#141418' }]}>
      <View style={styles.comingSoon}>
        <Icon name="folder-open" size={64} color="#fff" />
        <Text style={styles.comingSoonTitle}>Categories</Text>
        <Text style={styles.comingSoonText}>
          Smart content categories coming soon!
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
  clearButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(203,251,69,0.1)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    alignSelf: 'flex-start',
  },
  clearButtonText: {
    color: '#00D2BE',
    marginLeft: 8,
    fontSize: 14,
    fontWeight: '600',
  },
  searchContainer: {
    marginTop: 16,
    marginBottom: 8,
  },
  searchInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2a2a2a',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    color: '#fff',
    fontSize: responsiveFont(14),
  },
  clearSearchButton: {
    marginLeft: 8,
  },
  listContent: {
    paddingTop: 8,
    paddingHorizontal: 10,
    paddingBottom: 100,
  },
  row: {
    justifyContent: 'space-between',
    marginHorizontal: 10,
  },
  categoryCard: {
    width: (screenWidth - responsiveSize(40)) / 2,
    height: responsiveSize(140),
    marginVertical: responsiveSize(8),
    borderRadius: responsiveSize(16),
    overflow: 'hidden',
  },
  selectedCategoryCard: {
    transform: [{ scale: 0.98 }],
  },
  categoryGradient: {
    flex: 1,
    padding: responsiveSize(14), // Slightly less padding for more text space
    justifyContent: 'space-between',
  },
  categoryHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start', // Align to top for multi-line text
    marginBottom: responsiveSize(8),
    flexWrap: 'wrap',
  },
  categoryTitle: {
    fontSize: responsiveFont(12), // Much smaller for high-scaling devices
    fontWeight: 'bold',
    color: '#fff',
    marginLeft: responsiveSize(6),
    flex: 1,
    includeFontPadding: false, // Reduce extra padding on Android
  },
  categoryDescription: {
    fontSize: responsiveFont(11),
    color: '#ffffff90',
    lineHeight: responsiveFont(15),
  },
  categoryFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: responsiveSize(8),
  },
  categoryStats: {
    fontSize: responsiveFont(11),
    color: '#ffffff70',
    fontWeight: '600',
  },
  selectedInfo: {
    position: 'absolute',
    bottom: responsiveSize(100),
    left: responsiveSize(16),
    right: responsiveSize(16),
    borderRadius: responsiveSize(12),
    overflow: 'hidden',
  },
  selectedInfoGradient: {
    padding: responsiveSize(16),
  },
  selectedInfoText: {
    color: '#fff',
    fontSize: responsiveFont(14),
    textAlign: 'center',
  },
  selectedInfoHighlight: {
    color: '#00D2BE',
    fontWeight: 'bold',
  },
  selectedInfoCount: {
    color: '#9ca3af',
    fontSize: responsiveFont(12),
    textAlign: 'center',
    marginTop: responsiveSize(4),
  },
});

export default CategoriesTab;
