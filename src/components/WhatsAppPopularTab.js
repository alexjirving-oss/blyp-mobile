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
  Image,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import UnifiedVideo from './UnifiedVideo';
import { smartListGenerator } from '../utils/smartListGenerator';
import { responsiveFont } from '../utils/scaleUtils';
import { COLORS } from '../styles/theme';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

const WhatsAppPopularTab = ({
  posts = [],
  videos = [],
  onPopularPostSelect,
  navigation
}) => {
  const [popularityData, setPopularityData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [filteredPosts, setFilteredPosts] = useState([]);

  useEffect(() => {
    // Only reload if we don't have data or posts changed significantly
    if (!popularityData || posts.length === 0) {
      loadPopularContent();
    }
  }, [posts.length]); // Only depend on posts count, not full posts array

  const loadPopularContent = async () => {
    try {
      setLoading(true);
      console.log('ðŸ“Š Loading popular content rankings...');
      // Combine all real Firebase posts for analysis
      const allContent = [...posts].filter(post =>
        post.id && !post.id.startsWith('video-') // Filter out demo data
      );

      // Generate AI-powered popularity rankings
      const rankings = await smartListGenerator.generatePopularityRankings(allContent);

      if (rankings && rankings.categories) {
        setPopularityData(rankings);
        console.log('âœ… Popular content loaded:', rankings.categories.length, 'categories');
      } else {
        console.error('âŒ Invalid rankings data:', rankings);
      }
    } catch (error) {
      console.error('âŒ Error loading popular content:', error);
    } finally {

      setLoading(false);
    }
  };

  const handleCategoryPress = async (category) => {
    try {
      console.log('ðŸ“Š Filtering by popularity category:', category.name);
      setSelectedCategory(category);

      // Filter posts by popularity criteria
      const filtered = smartListGenerator.filterPostsByPopularity(
        popularityData.rankedPosts,
        category
      );
      setFilteredPosts(filtered);

      // Call parent callback if provided
      if (onPopularPostSelect) {
        onPopularPostSelect(category, filtered);
      }
    } catch (error) {
      console.error('âŒ Category selection error:', error);
    }
  };

  const renderPopularityCategory = ({ item: category }) => (
    <TouchableOpacity
      style={[
        styles.categoryCard,
        selectedCategory?.id === category.id && styles.selectedCategoryCard
      ]}
      onPress={() => handleCategoryPress(category)}
      activeOpacity={0.8}
    >
      <LinearGradient
        colors={[category.color, `${category.color}90`]}
        style={styles.categoryGradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <View style={styles.categoryHeader}>
          <Icon
            name={category.icon || 'trophy'}
            size={28}
            color="#fff"
          />
          <Text style={styles.categoryTitle}>{category.name}</Text>
        </View>

        <Text style={styles.categoryDescription} numberOfLines={2}>
          {category.description}
        </Text>

        <View style={styles.categoryFooter}>
          <Text style={styles.categoryCriteria} numberOfLines={1}>
            {category.criteria}
          </Text>
          <View style={styles.engagementBadge}>
            <Text style={styles.engagementScore}>
              {category.minEngagementScore}+
            </Text>
          </View>
        </View>
      </LinearGradient>
    </TouchableOpacity>
  );

  const renderPopularPost = ({ item: post, index }) => (
    <TouchableOpacity
      style={styles.postCard}
      onPress={() => {
        console.log('ðŸ“Š Opening popular post:', post.id);
        if (navigation) {
          navigation.navigate('MediaViewer', {
            postId: post.id,
            posts: filteredPosts,
            currentIndex: index
          });
        }
      }}
      activeOpacity={0.9}
    >
      <View style={styles.postRank}>
        <LinearGradient
          colors={index < 3 ? ['#ffd700', '#ff8c00'] : ['#27272E', '#3F3F46']}
          style={styles.rankBadge}
        >
          <Text style={styles.rankText}>#{index + 1}</Text>
        </LinearGradient>
      </View>

      <View style={styles.postMedia}>
        {post.type === 'video' ? (
          <UnifiedVideo
            source={{ uri: post.videoUrl }}
            style={styles.postThumbnail}
            resizeMode="cover"
            shouldPlay={false}
            isLooping={false}
          />
        ) : post.imageUrl || post.media?.[0]?.url ? (
          <Image
            source={{ uri: post.imageUrl || post.media[0].url }}
            style={styles.postThumbnail}
            resizeMode="cover"
          />
        ) : (
          <View style={[styles.postThumbnail, styles.placeholderThumbnail]}>
            <Icon name="image" size={40} color="#9ca3af" />
          </View>
        )}

        <View style={styles.mediaOverlay}>
          <Icon
            name={post.type === 'video' ? 'play-circle' : 'image'}
            size={24}
            color="#fff"
          />
        </View>
      </View>

      <View style={styles.postInfo}>
        <Text style={styles.postDescription} numberOfLines={3}>
          {post.description || 'No description'}
        </Text>

        <View style={styles.postMetrics}>
          <View style={styles.metric}>
            <Icon name="heart" size={14} color="#FB7185" />
            <Text style={styles.metricText}>{post.likeCount || post.likes || post.likedBy?.length || 0}</Text>
          </View>

          <View style={styles.metric}>
            <Icon name="chatbubble" size={14} color="#A1A1AA" />
            <Text style={styles.metricText}>{post.comments?.length || 0}</Text>
          </View>

          <View style={styles.metric}>
            <Icon name="share" size={14} color="#10b981" />
            <Text style={styles.metricText}>{post.shares || 0}</Text>
          </View>

          {post.engagementScore && (
            <View style={styles.scoreMetric}>
              <Icon name="trending-up" size={14} color="#f59e0b" />
              <Text style={styles.scoreText}>{Math.floor(post.engagementScore)}</Text>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );

  const renderHeader = () => (
    <View style={styles.header}>
      <View style={styles.headerTop}>
        <Text style={styles.headerTitle}>What's Hot</Text>
        <TouchableOpacity style={styles.hotButton}>
          <LinearGradient
            colors={['#ef4444', '#dc2626']}
            style={styles.hotGradient}
          >
            <Icon name="flame" size={20} color="#fff" />
          </LinearGradient>
        </TouchableOpacity>
      </View>

      <Text style={styles.headerSubtitle}>
        AI-ranked content by engagement â€¢ Most viral, liked & shared
      </Text>

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

  // Leaderboard-style placeholder body for What's Hot (EXACT PARITY)
  return (
    <View style={[styles.container, { backgroundColor: '#141418' }]}>
      <View style={styles.comingSoon}>
        <Icon name="flame" size={64} color="#fff" />
        <Text style={styles.comingSoonTitle}>What's Hot</Text>
        <Text style={styles.comingSoonText}>
          Top trending content will appear here soon!
        </Text>
      </View>
    </View>
  );

}

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
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  comingSoonTitle: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 8,
  },
  comingSoonText: {
    color: '#e5e7eb',
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 30,
  },
  headerTop: {
  flexDirection: 'row',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 8,
},
  headerTitle: {
  fontSize: responsiveFont(28),
  fontWeight: 'bold',
  color: '#fff',
},
  hotButton: {
  borderRadius: 20,
  overflow: 'hidden',
},
  hotGradient: {
  width: 40,
  height: 40,
  justifyContent: 'center',
  alignItems: 'center',
},
  headerSubtitle: {
  fontSize: responsiveFont(16),
  color: '#9ca3af',
  marginBottom: 20,
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
  listContent: {
  paddingTop: 8,
  paddingHorizontal: 10,
  paddingBottom: 100,
},
  categoryCard: {
  marginHorizontal: 10,
  marginVertical: 8,
  borderRadius: 16,
  overflow: 'hidden',
  height: 120,
},
  selectedCategoryCard: {
  transform: [{ scale: 0.98 }],
},
  categoryGradient: {
  flex: 1,
  padding: 20,
  justifyContent: 'space-between',
},
  categoryHeader: {
  flexDirection: 'row',
  alignItems: 'center',
  marginBottom: 8,
},
  categoryTitle: {
  fontSize: 18,
  fontWeight: 'bold',
  color: '#fff',
  marginLeft: 12,
  flex: 1,
},
  categoryDescription: {
  fontSize: 14,
  color: '#ffffff90',
  marginBottom: 8,
},
  categoryFooter: {
  flexDirection: 'row',
  justifyContent: 'space-between',
  alignItems: 'center',
},
  categoryCriteria: {
  fontSize: 12,
  color: '#ffffff70',
  flex: 1,
},
  engagementBadge: {
  backgroundColor: 'rgba(255,255,255,0.2)',
  paddingHorizontal: 8,
  paddingVertical: 4,
  borderRadius: 12,
},
  engagementScore: {
  fontSize: 12,
  color: '#fff',
  fontWeight: 'bold',
},
  postCard: {
  flexDirection: 'row',
  backgroundColor: '#141418',
  marginHorizontal: 10,
  marginVertical: 6,
  borderRadius: 12,
  padding: 12,
  position: 'relative',
},
  postRank: {
  position: 'absolute',
  top: -8,
  left: -8,
  zIndex: 10,
},
  rankBadge: {
  width: 32,
  height: 32,
  borderRadius: 16,
  justifyContent: 'center',
  alignItems: 'center',
},
  rankText: {
  color: '#fff',
  fontSize: 12,
  fontWeight: 'bold',
},
  postMedia: {
  width: 80,
  height: 80,
  borderRadius: 8,
  marginRight: 12,
  position: 'relative',
},
  postThumbnail: {
  width: 80,
  height: 80,
  borderRadius: 8,
},
  placeholderThumbnail: {
  backgroundColor: '#374151',
  justifyContent: 'center',
  alignItems: 'center',
},
  mediaOverlay: {
  position: 'absolute',
  bottom: 4,
  right: 4,
  backgroundColor: 'rgba(0,0,0,0.7)',
  borderRadius: 12,
  width: 24,
  height: 24,
  justifyContent: 'center',
  alignItems: 'center',
},
  postInfo: {
  flex: 1,
  justifyContent: 'space-between',
},
  postDescription: {
  color: '#fff',
  fontSize: 14,
  lineHeight: 18,
  marginBottom: 8,
},
  postMetrics: {
  flexDirection: 'row',
  alignItems: 'center',
},
  metric: {
  flexDirection: 'row',
  alignItems: 'center',
  marginRight: 12,
},
  metricText: {
  color: '#9ca3af',
  fontSize: 12,
  marginLeft: 4,
},
  scoreMetric: {
  flexDirection: 'row',
  alignItems: 'center',
  backgroundColor: 'rgba(245,158,11,0.1)',
  paddingHorizontal: 6,
  paddingVertical: 2,
  borderRadius: 8,
},
  scoreText: {
  color: '#f59e0b',
  fontSize: 12,
  fontWeight: 'bold',
  marginLeft: 4,
},
});

export default WhatsAppPopularTab;
