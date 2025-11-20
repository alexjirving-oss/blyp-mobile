import React, { useState } from 'react';
import Icon from '../../../src/components/Icon';
import { TouchableOpacity, StyleSheet, Dimensions, Modal, View, Text } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';

const CreatePostButton = ({ accessibilityState }) => {
  const navigation = useNavigation();
  const [showMenu, setShowMenu] = useState(false);
  const [showPostOptions, setShowPostOptions] = useState(false);

  const handlePress = () => {
    setShowMenu(true);
  };

  const handleMenuOption = (option) => {
    setShowMenu(false);
    switch (option) {
      case 'post':
        // Show the new post options overlay instead of going directly to Review
        setShowPostOptions(true);
        break;
      case 'photo':
        navigation.navigate('Camera');
        break;
      case 'video':
        navigation.navigate('Camera');
        break;
      case 'memo':
        navigation.navigate('VoiceMemo');
        break;
    }
  };

  const handlePostOption = (option) => {
    setShowPostOptions(false);
    switch (option) {
      case 'takePhoto':
        navigation.navigate('Camera');
        break;
      case 'takeVideo':
        navigation.navigate('Camera');
        break;
      case 'voiceNote':
        navigation.navigate('VoiceMemo');
        break;
      case 'myMedia':
        navigation.navigate('Review', { mode: 'new' });
        break;
    }
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

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => handleMenuOption('photo')}
            >
              <Icon  name="camera-outline" size={24} color="#d1d5db"  />
              <Text style={styles.menuItemText}>Photo</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => handleMenuOption('video')}
            >
              <Icon  name="videocam-outline" size={24} color="#d1d5db"  />
              <Text style={styles.menuItemText}>Video</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => handleMenuOption('memo')}
            >
              <Icon  name="mic-outline" size={24} color="#d1d5db"  />
              <Text style={styles.menuItemText}>Voice Memo</Text>
            </TouchableOpacity>
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
                onPress={() => handlePostOption('takePhoto')}
              >
                <View style={styles.postOptionIconContainer}>
                  <Icon  name="camera" size={28} color="#a855f7"  />
                </View>
                <Text style={styles.postOptionText}>Take Photo</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.postOptionButton}
                onPress={() => handlePostOption('takeVideo')}
              >
                <View style={styles.postOptionIconContainer}>
                  <Icon  name="videocam" size={28} color="#d946ef"  />
                </View>
                <Text style={styles.postOptionText}>Take Video</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.postOptionButton}
                onPress={() => handlePostOption('voiceNote')}
              >
                <View style={styles.postOptionIconContainer}>
                  <Icon  name="mic" size={28} color="#ec4899"  />
                </View>
                <Text style={styles.postOptionText}>Voice Note</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.postOptionButton}
                onPress={() => handlePostOption('myMedia')}
              >
                <View style={styles.postOptionIconContainer}>
                  <Icon  name="images" size={28} color="#8b5cf6"  />
                </View>
                <Text style={styles.postOptionText}>My Media</Text>
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