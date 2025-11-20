import React from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
const { width: screenWidth } = Dimensions.get('window');

const CollageShowcase = ({ 
  collageData = null, 
  onCreateCollage, 
  onViewCollage 
}) => {
  if (!collageData) {
    // Return null when no collage exists - no UI shown
    return null;
  }

  // Show just the raw collage image as background
  return (
    <View style={styles.backgroundContainer}>
      <Image 
        source={{ uri: collageData.uri }} 
        style={styles.backgroundImage}
        resizeMode="cover"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  backgroundContainer: {
    position: 'absolute',
    top: 154, // Start below the header (moved down 34px total)
    left: 0,
    right: 0,
    height: 220, // Height to accommodate profile picture overlay
    zIndex: 0, // Above background but below header and profile overlay
  },
  backgroundImage: {
    width: '100%',
    height: '100%',
  },
});

export default CollageShowcase;