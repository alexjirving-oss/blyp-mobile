import React, { useState, useRef, useEffect } from 'react';
import Icon from '../../../src/components/Icon';
import {
  View,
  ScrollView,
  Image,
  Dimensions,
  StyleSheet,
  TouchableOpacity,
  Text,
  Animated,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

const PhotoGallery = ({ photos, style }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const scrollViewRef = useRef(null);
  const intervalRef = useRef(null);

  const handleScroll = (event) => {
    const scrollPosition = event.nativeEvent.contentOffset.x;
    const index = Math.round(scrollPosition / screenWidth);
    console.log('📸 Gallery scroll:', { scrollPosition, index, screenWidth });
    setCurrentIndex(index);
  };

  const goToPhoto = (index) => {
    scrollViewRef.current?.scrollTo({
      x: index * screenWidth,
      y: 0,
      animated: true,
    });
    setCurrentIndex(index);
  };

  const nextPhoto = () => {
    if (photos.length <= 1) return;
    const nextIndex = (currentIndex + 1) % photos.length;
    goToPhoto(nextIndex);
  };

  const togglePlayPause = () => {
    setIsPlaying(!isPlaying);
  };

  // Automatic slideshow effect
  useEffect(() => {
    if (!isPlaying || photos.length <= 1) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      return;
    }

    intervalRef.current = setInterval(() => {
      setCurrentIndex(prevIndex => {
        const nextIndex = (prevIndex + 1) % photos.length;
        scrollViewRef.current?.scrollTo({
          x: nextIndex * screenWidth,
          y: 0,
          animated: true,
        });
        return nextIndex;
      });
    }, 3000); // 3 second interval

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isPlaying, photos.length]);

  // Clean up interval on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  if (!photos || photos.length === 0) {
    return null;
  }

  console.log('📸 PhotoGallery rendering', photos.length, 'photos');

  return (
    <View style={[styles.container, style]}>
      {/* Photo ScrollView with optimized settings */}
      <ScrollView
        ref={scrollViewRef}
        horizontal
        pagingEnabled={true}
        showsHorizontalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        bounces={false}
        decelerationRate="fast"
        directionalLockEnabled={true}
        snapToInterval={screenWidth}
        snapToAlignment="start"
        disableIntervalMomentum={true}
      >
        {photos.map((photo, index) => (
          <View key={index} style={styles.photoContainer}>
            <Image
              source={{ uri: photo.url || photo.uri }}
              style={styles.photo}
              resizeMode="cover"
              onLoadStart={() => console.log(`📸 Loading photo ${index + 1}/${photos.length}`)}
              onLoad={() => console.log(`✅ Photo ${index + 1} loaded successfully`)}
              onError={(error) => console.error(`❌ Photo ${index + 1} error:`, error)}
            />
          </View>
        ))}
      </ScrollView>

      {/* Photo Count Indicator */}
      {photos.length > 1 && (
        <View style={styles.indicatorContainer}>
          <LinearGradient
            colors={['rgba(0,0,0,0.6)', 'rgba(0,0,0,0.8)']}
            style={styles.indicatorBackground}
          >
            <Text style={styles.indicatorText}>
              {currentIndex + 1} / {photos.length}
            </Text>
          </LinearGradient>
        </View>
      )}

      {/* Play/Pause Control */}
      {photos.length > 1 && (
        <TouchableOpacity 
          style={styles.playPauseButton} 
          onPress={togglePlayPause}
          activeOpacity={0.7}
        >
          <LinearGradient
            colors={['rgba(0,0,0,0.6)', 'rgba(0,0,0,0.8)']}
            style={styles.playPauseBackground}
          >
            <Icon  
              name={isPlaying ? 'pause' : 'play'} 
              size={20} 
              color="#fff" 
             />
          </LinearGradient>
        </TouchableOpacity>
      )}

      {/* Dot Indicators */}
      {photos.length > 1 && photos.length <= 10 && (
        <View style={styles.dotsContainer}>
          {photos.map((_, index) => (
            <TouchableOpacity
              key={index}
              style={[
                styles.dot,
                index === currentIndex && styles.activeDot,
              ]}
              onPress={() => goToPhoto(index)}
            />
          ))}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: screenWidth,
    height: screenHeight,
    backgroundColor: '#000',
  },
  scrollView: {
    width: screenWidth,
    height: screenHeight,
  },
  scrollContent: {
    flexDirection: 'row',
  },
  photoContainer: {
    width: screenWidth,
    height: screenHeight,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
  },
  photo: {
    width: screenWidth,
    height: screenHeight,
  },
  indicatorContainer: {
    position: 'absolute',
    top: 60,
    right: 16,
    zIndex: 100,
  },
  indicatorBackground: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  indicatorText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  dotsContainer: {
    position: 'absolute',
    bottom: 100,
    left: 0,
    right: 80, // Leave space for right sidebar
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.5)',
    marginHorizontal: 4,
  },
  activeDot: {
    backgroundColor: '#fff',
    width: 24,
  },
  playPauseButton: {
    position: 'absolute',
    top: 60,
    left: 16,
    zIndex: 100,
  },
  playPauseBackground: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default PhotoGallery;