import React, { useState } from 'react';
import Icon from './Icon';
import { TouchableOpacity, StyleSheet, Dimensions, Modal, View, Text, Alert } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../hooks/useCommon';
import { isLiveStreamingEnabled } from '../config/StreamingFeatureFlag';

const CreatePostButton = ({ accessibilityState }) => {
  const navigation = useNavigation();
  const [showMenu, setShowMenu] = useState(false);
  const [showPostOptions, setShowPostOptions] = useState(false);
  const { uid, isAuthenticated, authReady } = useAuth();
  const streamingEnabled = isLiveStreamingEnabled();
  
  // Visibility: show buttons always, do auth checks at action time
  const canShowPlusMenu = true; // Always allow opening menu
  const canShowPost = true; // Always show Post option
  const canShowGoLive = streamingEnabled; // Show Go Live when streaming enabled

  const handlePress = () => {
    setShowMenu(true);
  };

  const handleMenuOption = (option) => {
    setShowMenu(false);
    switch (option) {
      case 'post':
        // Check auth readiness first
        if (!authReady) {
          Alert.alert(
            'Please wait',
            'Still loading your account. Please try again in a moment.'
          );
          return;
        }
        // Check auth before showing post options
        if (!isAuthenticated || !uid) {
          Alert.alert(
            'Login required',
            'You need to be logged in to create a post. Please log in and try again.'
          );
          return;
        }
        // Show the new post options overlay instead of going directly to Review
        setShowPostOptions(true);
        break;
      case 'live':
        if (!streamingEnabled) {
          Alert.alert(
            'Live streaming disabled',
            'Live streaming is currently turned off for this build.'
          );
          return;
        }
        // Check auth readiness
        if (!authReady) {
          Alert.alert(
            'Please wait',
            'Still loading your account. Please try again in a moment.'
          );
          return;
        }
        // Check authentication
        if (!isAuthenticated || !uid) {
          Alert.alert(
            'Login required',
            'You need to be logged in to go live. Please log in and try again.'
          );
          return;
        }
        console.log('[LIVE][ENTRY] Navigating to LiveStreamScreen from plus menu', {
          authReady,
          isAuthenticated,
          hasUid: !!uid,
          streamingEnabled
        });
        // Auth check is also done in LiveStreamScreen itself (defense-in-depth)
        navigation.navigate('LiveStreamScreen', { mode: 'host' });
        break;
    }
  };

  const handlePostOption = (option) => {
    // Verify auth readiness
    if (!authReady) {
      Alert.alert("Please wait", "Still loading your account.");
      return;
    }
    // Verify authentication with uid check
    if (!isAuthenticated || !uid) {
      Alert.alert(
        "Login Required",
        "You must be logged in to create a post. Please log in and try again."
      );
      return;
    }

    setShowPostOptions(false);

    console.log('[POST][ENTRY] Navigating to Review from plus menu', {
      option,
      authReady,
      isAuthenticated,
      hasUid: !!uid
    });

    if (option === "photo") {
      navigation.navigate("Review", { mode: "photo", entryPoint: "plus_menu" });
      return;
    }

    if (option === "video") {
      navigation.navigate("Review", { mode: "video", entryPoint: "plus_menu" });
      return;
    }

    console.warn("[POST] Unknown option:", option);
  };

  return (
    <>
      <View style={styles.container}>
        <TouchableOpacity
          style={styles.button}
          onPress={handlePress}
          activeOpacity={0.8}
        >
          <LinearGradient
            colors={['#a855f7', '#d946ef', '#ec4899']}
            style={styles.gradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <Icon  name="add" size={28} color="white"  />
          </LinearGradient>
        </TouchableOpacity>
      </View>

      <Modal
        visible={showMenu}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowMenu(false)}
      >
        <TouchableOpacity 
          style={styles.modalBackdrop} 
          activeOpacity={1} 
          onPress={() => setShowMenu(false)}
        >
          <View style={styles.menuContainer}>
            <View style={styles.menuHandle} />
            
            {canShowPost && (
              <TouchableOpacity
                style={styles.menuItem}
                onPress={() => handleMenuOption('post')}
              >
                <LinearGradient
                  colors={['#a855f7', '#d946ef', '#ec4899']}
                  style={styles.menuItemGradient}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                >
                  <Text style={styles.menuItemTextMain}>New Post</Text>
                </LinearGradient>
              </TouchableOpacity>
            )}

            {canShowGoLive && (
              <TouchableOpacity
                style={styles.menuItem}
                onPress={() => handleMenuOption('live')}
              >
                <LinearGradient
                  colors={['#ef4444', '#dc2626', '#b91c1c']}
                  style={styles.menuItemGradient}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                >
                  <View style={styles.liveButtonContent}>
                    <Icon  name="radio-outline" size={20} color="#ffffff"  />
                    <Text style={styles.menuItemTextLive}>Go Live</Text>
                  </View>
                </LinearGradient>
              </TouchableOpacity>
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* New Post Options Modal */}
      <Modal
        visible={showPostOptions}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowPostOptions(false)}
      >
        <TouchableOpacity 
          style={styles.modalBackdrop} 
          activeOpacity={1} 
          onPress={() => setShowPostOptions(false)}
        >
          <View style={styles.postOptionsContainer}>
            <View style={styles.menuHandle} />
            
            <Text style={styles.postOptionsTitle}>Create New Post</Text>
            
            <View style={styles.postOptionsGrid}>
              <TouchableOpacity
                style={styles.postOptionButton}
                onPress={() => handlePostOption('photo')}
              >
                <View style={styles.postOptionIconContainer}>
                  <Icon  name="camera" size={28} color="#a855f7"  />
                </View>
                <Text style={styles.postOptionText}>Photo</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.postOptionButton}
                onPress={() => handlePostOption('video')}
              >
                <View style={styles.postOptionIconContainer}>
                  <Icon  name="videocam" size={28} color="#d946ef"  />
                </View>
                <Text style={styles.postOptionText}>Video</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: -20,
  },
  button: {
    width: 56,
    height: 56,
    borderRadius: 28,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  gradient: {
    width: '100%',
    height: '100%',
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  menuContainer: {
    backgroundColor: '#1e293b',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 16,
    paddingBottom: 32,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  menuHandle: {
    width: 48,
    height: 6,
    backgroundColor: '#475569',
    borderRadius: 3,
    alignSelf: 'center',
    marginBottom: 16,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginBottom: 8,
    backgroundColor: '#374151',
  },
  menuItemGradient: {
    paddingVertical: 4,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  menuItemText: {
    color: '#d1d5db',
    fontSize: 18,
    fontWeight: '600',
    marginLeft: 12,
  },
  menuItemTextMain: {
    color: 'white',
    fontSize: 20,
    fontWeight: '800',
  },
  liveButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuItemTextLive: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
    marginLeft: 8,
  },
  
  // Post Options Styles
  postOptionsContainer: {
    backgroundColor: '#1e293b',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingBottom: 40,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  postOptionsTitle: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 24,
  },
  postOptionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  postOptionButton: {
    width: '48%',
    alignItems: 'center',
    paddingVertical: 20,
    paddingHorizontal: 16,
    backgroundColor: '#374151',
    borderRadius: 16,
    marginBottom: 16,
  },
  postOptionIconContainer: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#1e293b',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 2,
    borderColor: '#475569',
  },
  postOptionText: {
    color: '#d1d5db',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
});

export default CreatePostButton;