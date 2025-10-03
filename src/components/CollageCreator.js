import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  ScrollView,
  Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { captureRef } from 'react-native-view-shot';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';

const { width: screenWidth } = Dimensions.get('window');

const CollageCreator = ({ photos = [], onCollageCreated, onClose }) => {
  const [selectedLayout, setSelectedLayout] = useState(0);
  const [isCreating, setIsCreating] = useState(false);
  const collageRef = useRef(null);

  // Calculate collage dimensions (16:9 aspect ratio)
  const collageWidth = screenWidth - 40; // 20px margin on each side
  const collageHeight = (collageWidth * 9) / 16;

  // Layout configurations for different numbers of photos
  const getLayoutConfig = (photoCount, layoutIndex = 0) => {
    const configs = {
      1: [
        // Single photo - full width
        [{ x: 0, y: 0, width: 1, height: 1 }]
      ],
      2: [
        // Side by side
        [
          { x: 0, y: 0, width: 0.495, height: 1 },
          { x: 0.505, y: 0, width: 0.495, height: 1 }
        ],
        // Top and bottom
        [
          { x: 0, y: 0, width: 1, height: 0.495 },
          { x: 0, y: 0.505, width: 1, height: 0.495 }
        ]
      ],
      3: [
        // One large on left, two small on right
        [
          { x: 0, y: 0, width: 0.66, height: 1 },
          { x: 0.67, y: 0, width: 0.33, height: 0.495 },
          { x: 0.67, y: 0.505, width: 0.33, height: 0.495 }
        ],
        // One large on top, two small on bottom
        [
          { x: 0, y: 0, width: 1, height: 0.66 },
          { x: 0, y: 0.67, width: 0.495, height: 0.33 },
          { x: 0.505, y: 0.67, width: 0.495, height: 0.33 }
        ],
        // Three equal horizontal strips
        [
          { x: 0, y: 0, width: 1, height: 0.32 },
          { x: 0, y: 0.34, width: 1, height: 0.32 },
          { x: 0, y: 0.68, width: 1, height: 0.32 }
        ]
      ],
      4: [
        // 2x2 grid
        [
          { x: 0, y: 0, width: 0.495, height: 0.495 },
          { x: 0.505, y: 0, width: 0.495, height: 0.495 },
          { x: 0, y: 0.505, width: 0.495, height: 0.495 },
          { x: 0.505, y: 0.505, width: 0.495, height: 0.495 }
        ],
        // One large + three small
        [
          { x: 0, y: 0, width: 0.66, height: 0.66 },
          { x: 0.67, y: 0, width: 0.33, height: 0.32 },
          { x: 0.67, y: 0.34, width: 0.33, height: 0.32 },
          { x: 0.67, y: 0.68, width: 0.33, height: 0.32 }
        ]
      ]
    };

    const layoutsForCount = configs[Math.min(photoCount, 4)] || configs[4];
    return layoutsForCount[layoutIndex % layoutsForCount.length];
  };

  const renderCollage = () => {
    if (photos.length === 0) return null;

    const layout = getLayoutConfig(photos.length, selectedLayout);

    return (
      <View
        ref={collageRef}
        style={[
          styles.collageContainer,
          { width: collageWidth, height: collageHeight }
        ]}
      >
        {photos.slice(0, layout.length).map((photo, index) => {
          const config = layout[index];
          return (
            <Image
              key={index}
              source={{ uri: photo.uri }}
              style={[
                styles.collageImage,
                {
                  left: config.x * collageWidth,
                  top: config.y * collageHeight,
                  width: config.width * collageWidth,
                  height: config.height * collageHeight,
                }
              ]}
              resizeMode="cover"
            />
          );
        })}
        
        {/* Watermark */}
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.3)']}
          style={styles.watermarkGradient}
        >
          <Text style={styles.watermark}>Blyp</Text>
        </LinearGradient>
      </View>
    );
  };

  const renderLayoutOptions = () => {
    if (photos.length <= 1) return null;

    const maxLayouts = getLayoutConfig(photos.length).length || 1;
    const layoutOptions = Array.from({ length: maxLayouts }, (_, i) => i);

    return (
      <View style={styles.layoutOptions}>
        <Text style={styles.layoutTitle}>Choose Layout:</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.layoutScroll}>
          {layoutOptions.map((layoutIndex) => (
            <TouchableOpacity
              key={layoutIndex}
              onPress={() => setSelectedLayout(layoutIndex)}
              style={[
                styles.layoutPreview,
                selectedLayout === layoutIndex && styles.selectedLayout
              ]}
            >
              <View style={styles.miniCollage}>
                {getLayoutConfig(photos.length, layoutIndex).map((config, index) => (
                  <View
                    key={index}
                    style={[
                      styles.miniImage,
                      {
                        left: config.x * 80,
                        top: config.y * 45,
                        width: config.width * 80,
                        height: config.height * 45,
                      }
                    ]}
                  />
                ))}
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    );
  };

  const createCollage = async () => {
    if (!collageRef.current) return;

    try {
      setIsCreating(true);

      // Request media library permissions
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Please grant photo library access to save the collage.');
        return;
      }

      // Capture the collage as an image
      const uri = await captureRef(collageRef.current, {
        format: 'jpg',
        quality: 0.9,
        width: collageWidth * 2, // Higher resolution
        height: collageHeight * 2,
      });

      console.log('📸 Collage created:', uri);

      // Save to photo library
      const asset = await MediaLibrary.createAssetAsync(uri);
      
      Alert.alert(
        'Collage Created! 🎨',
        'Your collage has been saved to your photo library.',
        [
          {
            text: 'Share',
            onPress: () => shareCollage(uri)
          },
          {
            text: 'Use in Post',
            onPress: () => onCollageCreated && onCollageCreated(uri)
          },
          { text: 'OK' }
        ]
      );

    } catch (error) {
      console.error('❌ Error creating collage:', error);
      Alert.alert('Error', 'Failed to create collage. Please try again.');
    } finally {
      setIsCreating(false);
    }
  };

  const shareCollage = async (uri) => {
    try {
      const isAvailable = await Sharing.isAvailableAsync();
      if (isAvailable) {
        await Sharing.shareAsync(uri, {
          mimeType: 'image/jpeg',
          dialogTitle: 'Share your Blyp collage',
        });
      }
    } catch (error) {
      console.error('❌ Error sharing collage:', error);
    }
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <LinearGradient
        colors={['#667eea', '#764ba2']}
        style={styles.header}
      >
        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
          <Text style={styles.closeText}>✕</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Create Collage</Text>
        <View style={styles.placeholder} />
      </LinearGradient>

      <ScrollView style={styles.content}>
        {/* Collage Preview */}
        <View style={styles.previewContainer}>
          {renderCollage()}
        </View>

        {/* Layout Options */}
        {renderLayoutOptions()}

        {/* Create Button */}
        <TouchableOpacity
          onPress={createCollage}
          disabled={isCreating || photos.length === 0}
          style={[
            styles.createButton,
            (isCreating || photos.length === 0) && styles.disabledButton
          ]}
        >
          <LinearGradient
            colors={isCreating ? ['#666', '#888'] : ['#667eea', '#764ba2']}
            style={styles.createButtonGradient}
          >
            <Text style={styles.createButtonText}>
              {isCreating ? 'Creating...' : 'Create Collage 🎨'}
            </Text>
          </LinearGradient>
        </TouchableOpacity>

        {/* Info */}
        <Text style={styles.infoText}>
          📱 Your collage will be saved in 16:9 widescreen format, perfect for social media!
        </Text>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 50,
    paddingHorizontal: 20,
    paddingBottom: 15,
  },
  closeButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  placeholder: {
    width: 30,
  },
  content: {
    flex: 1,
    padding: 20,
  },
  previewContainer: {
    alignItems: 'center',
    marginBottom: 30,
  },
  collageContainer: {
    position: 'relative',
    backgroundColor: '#222',
    borderRadius: 12,
    overflow: 'hidden',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  collageImage: {
    position: 'absolute',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  watermarkGradient: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderTopLeftRadius: 8,
  },
  watermark: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  layoutOptions: {
    marginBottom: 30,
  },
  layoutTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 15,
  },
  layoutScroll: {
    flexDirection: 'row',
  },
  layoutPreview: {
    marginRight: 15,
    padding: 5,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  selectedLayout: {
    backgroundColor: 'rgba(102, 126, 234, 0.3)',
    borderWidth: 2,
    borderColor: '#667eea',
  },
  miniCollage: {
    width: 80,
    height: 45,
    position: 'relative',
    backgroundColor: '#333',
    borderRadius: 4,
    overflow: 'hidden',
  },
  miniImage: {
    position: 'absolute',
    backgroundColor: '#667eea',
    borderRadius: 2,
    opacity: 0.8,
  },
  createButton: {
    marginBottom: 20,
  },
  disabledButton: {
    opacity: 0.6,
  },
  createButtonGradient: {
    paddingVertical: 15,
    paddingHorizontal: 30,
    borderRadius: 25,
    alignItems: 'center',
  },
  createButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  infoText: {
    color: '#aaa',
    textAlign: 'center',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 20,
  },
});

export default CollageCreator;