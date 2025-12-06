import React, { useState, useEffect, useMemo } from 'react';
import Icon from '../components/Icon';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Image,
  Alert,
  StatusBar,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { storage, firestore as db } from '../config/firebase';
import { useAuth } from '../hooks/useCommon';
import BlypLogo from '../components/BlypLogo';

const EditProfileScreen = ({ navigation, route }) => {
  const profileFromRoute = route?.params?.profile ?? route?.params?.user ?? null;
  const { uid, user: authUser, isAuthenticated, hasUser, authReady, getDisplayName } = useAuth();
  const [displayName, setDisplayName] = useState(profileFromRoute?.displayName ?? '');
  const [bio, setBio] = useState(profileFromRoute?.bio ?? '');
  const [profileImage, setProfileImage] = useState(profileFromRoute?.photoURL ?? '');
  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const resolvedEmail = useMemo(() => {
    if (profileFromRoute?.email) return profileFromRoute.email;
    if (authUser?.email) return authUser.email;
    if (authUser?.attributes?.email) return authUser.attributes.email;
    return '';
  }, [authUser, profileFromRoute]);

  // Load user profile data on component mount
  useEffect(() => {
    const loadUserProfile = async () => {
      if (!uid) {
        setLoading(false);
        return;
      }

      try {
        const displayFromAuth = typeof getDisplayName === 'function' ? getDisplayName() : '';
        if (displayFromAuth && !displayName) {
          setDisplayName(displayFromAuth);
        }
        if (authUser?.photoURL && !profileImage) {
          setProfileImage(authUser.photoURL);
        }

        const userDocRef = doc(db, 'users', uid);
        const userDoc = await getDoc(userDocRef);
        
        if (userDoc.exists()) {
          const userData = userDoc.data();
          if (userData.displayName) setDisplayName((prev) => prev || userData.displayName);
          if (userData.bio) setBio(userData.bio);
          if (userData.photoURL) setProfileImage((prev) => prev || userData.photoURL);
        }
      } catch (error) {
        console.error('Error loading user profile:', error);
      } finally {
        setLoading(false);
      }
    };

    loadUserProfile();
  }, [uid, authUser, getDisplayName]);

  const pickImage = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission required', 'Please grant photo library permissions');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        setProfileImage(result.assets[0].uri);
      }
    } catch (error) {
      console.error('Error picking image:', error);
      Alert.alert('Error', 'Failed to select image');
    }
  };

  const takePhoto = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission required', 'Please grant camera permissions');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        setProfileImage(result.assets[0].uri);
      }
    } catch (error) {
      console.error('Error taking photo:', error);
      Alert.alert('Error', 'Failed to take photo');
    }
  };

  const showImagePicker = () => {
    Alert.alert(
      'Update Profile Photo',
      'Choose an option',
      [
        { text: 'Camera', onPress: takePhoto },
        { text: 'Photo Library', onPress: pickImage },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  const uploadProfileImage = async (imageUri, userId) => {
    if (!userId) throw new Error('User not authenticated');

    const response = await fetch(imageUri);
    const blob = await response.blob();
    
    // Use a simpler path structure that works with default Firebase Storage rules
    const fileName = `${userId}-profile-${Date.now()}.jpg`;
    const storageRef = ref(storage, `users/${userId}/profile/${fileName}`);
    
    await uploadBytes(storageRef, blob);
    const downloadURL = await getDownloadURL(storageRef);
    
    return downloadURL;
  };

  const handleSave = async () => {
    if (!uid || !isAuthenticated || !hasUser || !authReady) {
      console.error('[EditProfile] Save blocked: no authenticated user', { uid, isAuthenticated, hasUser, authReady });
      Alert.alert('Error', 'You must be logged in to update your profile.');
      return;
    }

    if (!displayName.trim()) {
      Alert.alert('Error', 'Please enter a display name');
      return;
    }

    setIsSaving(true);
    
    try {
      let photoURL = profileImage;

      // Upload new profile image if a local URI is present
      if (profileImage && (profileImage.startsWith('file:') || profileImage.startsWith('content:') || profileImage.startsWith('asset:'))) {
        setIsUploading(true);
        photoURL = await uploadProfileImage(profileImage, uid);
        setIsUploading(false);
      }

      // Save profile data to Firestore using Cognito uid
      const userDocRef = doc(db, 'users', uid);
      await setDoc(userDocRef, {
        displayName: displayName.trim(),
        photoURL: photoURL,
        bio: bio.trim(),
        email: resolvedEmail,
        updatedAt: new Date(),
      }, { merge: true });

      Alert.alert('Success', 'Profile updated successfully!', [
        { text: 'OK', onPress: () => navigation.goBack() }
      ]);
      
    } catch (error) {
      console.error('Error updating profile:', error);
      Alert.alert('Error', 'Failed to update profile. Please try again.');
    } finally {
      setIsSaving(false);
      setIsUploading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent={true} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Icon  name="arrow-back" size={24} color="#ffffff"  />
        </TouchableOpacity>
        <BlypLogo useGradientBackground={false} textStyle={{ fontSize: 24 }} />
        <TouchableOpacity 
          onPress={() => {
            handleSave().catch(error => {
              console.error('Save error:', error);
            });
          }} 
          disabled={isSaving}
          style={styles.saveButtonContainer}
        >
          <Text style={[styles.saveButton, isSaving && styles.saveButtonDisabled]}>
            {isSaving ? 'Saving...' : 'Save'}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Profile Image Section */}
        <View style={styles.imageSection}>
          <TouchableOpacity onPress={showImagePicker} style={styles.imageContainer}>
            <Image
              source={{
                uri: profileImage || `https://placehold.co/120x120/475569/e2e8f0?text=${displayName.charAt(0).toUpperCase() || 'A'}`
              }}
              style={styles.profileImage}
            />
            <View style={styles.imageOverlay}>
              <Icon  name="camera" size={24} color="#ffffff"  />
            </View>
          </TouchableOpacity>
          {isUploading && (
            <Text style={styles.uploadingText}>Uploading image...</Text>
          )}
        </View>

        {/* Form Section */}
        <View style={styles.formSection}>
          <View style={styles.inputContainer}>
            <Text style={styles.label}>Display Name</Text>
            <TextInput
              style={styles.input}
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="Enter your display name"
              placeholderTextColor="#9ca3af"
              maxLength={50}
            />
            <Text style={styles.characterCount}>{displayName.length}/50</Text>
          </View>

          <View style={styles.inputContainer}>
            <Text style={styles.label}>Bio</Text>
            <TextInput
              style={[styles.input, styles.bioInput]}
              value={bio}
              onChangeText={setBio}
              placeholder="Tell us about yourself..."
              placeholderTextColor="#9ca3af"
              multiline
              maxLength={150}
            />
            <Text style={styles.characterCount}>{bio.length}/150</Text>
          </View>

          <View style={styles.inputContainer}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={[styles.input, styles.disabledInput]}
              value={resolvedEmail}
              editable={false}
              placeholder="Email address"
              placeholderTextColor="#6b7280"
            />
            <Text style={styles.helperText}>Email cannot be changed</Text>
          </View>
        </View>

        {/* Additional Options */}
        <View style={styles.optionsSection}>
          <TouchableOpacity style={styles.optionItem}>
            <Icon  name="notifications-outline" size={24} color="#d1d5db"  />
            <Text style={styles.optionText}>Notification Settings</Text>
            <Icon  name="chevron-forward" size={20} color="#9ca3af"  />
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.optionItem}>
            <Icon  name="shield-outline" size={24} color="#d1d5db"  />
            <Text style={styles.optionText}>Privacy & Security</Text>
            <Icon  name="chevron-forward" size={20} color="#9ca3af"  />
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.optionItem}>
            <Icon  name="help-circle-outline" size={24} color="#d1d5db"  />
            <Text style={styles.optionText}>Help & Support</Text>
            <Icon  name="chevron-forward" size={20} color="#9ca3af"  />
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  header: {
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 50,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '600',
  },
  saveButton: {
    color: '#a855f7',
    fontSize: 16,
    fontWeight: '600',
  },
  saveButtonDisabled: {
    color: '#6b7280',
  },
  saveButtonContainer: {
    padding: 8,
  },
  backButton: {
    padding: 8,
  },
  content: {
    flex: 1,
  },
  imageSection: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  imageContainer: {
    position: 'relative',
  },
  profileImage: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 3,
    borderColor: '#475569',
  },
  imageOverlay: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: '#a855f7',
    borderRadius: 20,
    padding: 8,
    borderWidth: 3,
    borderColor: '#0f172a',
  },
  uploadingText: {
    color: '#9ca3af',
    fontSize: 14,
    marginTop: 8,
  },
  formSection: {
    paddingHorizontal: 16,
  },
  inputContainer: {
    marginBottom: 24,
  },
  label: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    color: '#ffffff',
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#475569',
  },
  bioInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  disabledInput: {
    backgroundColor: '#374151',
    color: '#9ca3af',
  },
  characterCount: {
    color: '#9ca3af',
    fontSize: 12,
    textAlign: 'right',
    marginTop: 4,
  },
  helperText: {
    color: '#6b7280',
    fontSize: 12,
    marginTop: 4,
  },
  optionsSection: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 32,
  },
  optionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 16,
    backgroundColor: '#1e293b',
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#475569',
  },
  optionText: {
    flex: 1,
    color: '#f8fafc',
    fontSize: 16,
    marginLeft: 16,
  },
});

export default EditProfileScreen;