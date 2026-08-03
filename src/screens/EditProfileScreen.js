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
import { doc, getDoc, setDoc, collection, query, where, getDocs, limit as fsLimit } from 'firebase/firestore';
import { auth, storage, firestore as db } from '../config/firebase';
import { useAuth } from '../hooks/useCommon';
import BlypLogo from '../components/BlypLogo';
import { COLORS } from '../styles/theme';

const EditProfileScreen = ({ navigation, route }) => {
  const profileFromRoute = route?.params?.profile ?? route?.params?.user ?? null;
  const { user: authUser, isAuthenticated, loading: authLoading } = useAuth();
  // Prefer federated Firebase uid (Cognito sub); fall back to Cognito username only for display helpers.
  const uid = auth?.currentUser?.uid || null;
  const authReady = !authLoading;
  const hasUser = !!(uid || authUser);
  const getDisplayName = () => {
    try {
      if (typeof authUser?.getUsername === 'function') {
        const name = String(authUser.getUsername() || '').trim();
        if (name && !name.includes('@')) return name;
      }
    } catch {}
    return String(auth?.currentUser?.displayName || profileFromRoute?.displayName || '').trim();
  };
  const [displayName, setDisplayName] = useState(profileFromRoute?.displayName ?? '');
  const [username, setUsername] = useState(profileFromRoute?.username ?? profileFromRoute?.handle ?? '');
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

  const legacyUserId = useMemo(() => {
    try {
      const raw =
        profileFromRoute?.username ||
        profileFromRoute?.handle ||
        authUser?.username ||
        (typeof authUser?.getUsername === 'function' ? authUser.getUsername() : null) ||
        '';
      const s = String(raw || '').trim();
      if (!s) return null;
      const noAt = s.startsWith('@') ? s.slice(1) : s;
      const normalized = noAt.trim().toLowerCase();
      if (!normalized) return null;
      if (!uid) return normalized;
      if (normalized === String(uid).toLowerCase()) return null;
      return normalized;
    } catch {
      return null;
    }
  }, [authUser, profileFromRoute, uid]);

  // Load user profile data on component mount
  useEffect(() => {
    const loadUserProfile = async () => {
      if (!uid) {
        setLoading(false);
        return;
      }

      try {
        // Display name must always mirror username. Do not hydrate it from Cognito uid-like fallbacks.
        // Prefer Firestore username/handle, then a human-friendly auth-derived display name.
        const displayFromAuth = typeof getDisplayName === 'function' ? getDisplayName() : '';
        if (displayFromAuth && !username) {
          setUsername(displayFromAuth);
        }
        if (authUser?.photoURL && !profileImage) {
          setProfileImage(authUser.photoURL);
        }

        const userDocRef = doc(db, 'users', uid);
        const userDoc = await getDoc(userDocRef);
        
        if (userDoc.exists()) {
          const userData = userDoc.data();
          if (userData.username || userData.handle) setUsername((prev) => prev || (userData.username || userData.handle));
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

  // Keep displayName synced to username (requirement: always match).
  useEffect(() => {
    const raw = String(username || '').trim();
    const noAt = raw.startsWith('@') ? raw.slice(1) : raw;
    const mirrored = noAt.trim();
    if (mirrored && displayName !== mirrored) {
      setDisplayName(mirrored);
    }
  }, [username, displayName]);

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

  const backfillAuthorMetaOnPosts = async ({ ownerUserId, newDisplayName, newUsername, newPhotoURL }) => {
    if (!ownerUserId) return;
    try {
      const postsRef = collection(db, 'posts');
      const q = query(postsRef, where('userId', '==', ownerUserId), fsLimit(200));
      const snap = await getDocs(q);
      if (!snap?.docs?.length) return;

      const trimmedName = String(newDisplayName || '').trim();
      const trimmedUsername = String(newUsername || '').trim();
      const authorLabel = trimmedUsername || trimmedName;
      const trimmedPhoto = String(newPhotoURL || '').trim();
      const patch = {
        ...(authorLabel ? { username: authorLabel, userDisplayName: authorLabel } : {}),
        ...(trimmedPhoto ? { userPhotoURL: trimmedPhoto } : {}),
        user: {
          ...(authorLabel ? { username: authorLabel, displayName: authorLabel } : {}),
          ...(trimmedPhoto ? { avatar: trimmedPhoto } : {}),
        },
        updatedAt: new Date(),
      };

      // Update docs sequentially to avoid overwhelming dev emulator / device.
      for (const d of snap.docs) {
        try {
          await setDoc(doc(db, 'posts', d.id), patch, { merge: true });
        } catch (e) {
          console.warn('[EditProfile] Post author-meta backfill failed for', d.id, e?.message || e);
        }
      }
    } catch (e) {
      console.warn('[EditProfile] Post author-meta backfill failed', e?.message || e);
    }
  };

  const handleSave = async () => {
    if (!uid || !isAuthenticated || !hasUser || !authReady) {
      console.error('[EditProfile] Save blocked: no authenticated user', { uid, isAuthenticated, hasUser, authReady });
      Alert.alert('Error', 'You must be logged in to update your profile.');
      return;
    }

    // Username is required and is the single source of truth for display name.
    const normalizedUsername = (() => {
      const raw = String(username || '').trim();
      if (!raw) return null;
      const noAt = raw.startsWith('@') ? raw.slice(1) : raw;
      // Allow letters/numbers/underscore/dot, 3-20 chars (basic guard; not enforcing uniqueness here)
      const cleaned = noAt.trim();
      if (!/^[A-Za-z0-9_.]{3,20}$/.test(cleaned)) {
        return null;
      }
      return cleaned;
    })();

    if (!normalizedUsername) {
      Alert.alert('Invalid username', 'Enter a username (3-20 chars: letters, numbers, underscore, or dot).');
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
        displayName: normalizedUsername,
        username: normalizedUsername,
        handle: normalizedUsername,
        photoURL: photoURL,
        bio: bio.trim(),
        email: resolvedEmail,
        updatedAt: new Date(),
      }, { merge: true });

      // Mirror to legacy username-based doc (if applicable) so existing posts/profile remain consistent.
      try {
        if (legacyUserId) {
          const legacyDocRef = doc(db, 'users', legacyUserId);
          await setDoc(legacyDocRef, {
            displayName: normalizedUsername,
            username: normalizedUsername,
            handle: normalizedUsername,
            photoURL: photoURL,
            bio: bio.trim(),
            email: resolvedEmail,
            updatedAt: new Date(),
            linkedSub: uid,
          }, { merge: true });
        }
      } catch (e) {
        console.warn('[EditProfile] Legacy profile mirror write failed', e?.message || e);
      }

      // Backfill author meta on existing posts so Home/MediaViewer show updated name/photo.
      await backfillAuthorMetaOnPosts({ ownerUserId: uid, newDisplayName: normalizedUsername, newUsername: normalizedUsername, newPhotoURL: photoURL });
      if (legacyUserId) {
        await backfillAuthorMetaOnPosts({ ownerUserId: legacyUserId, newDisplayName: normalizedUsername, newUsername: normalizedUsername, newPhotoURL: photoURL });
      }

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
                uri: profileImage || `https://placehold.co/120x120/475569/e2e8f0?text=${(String(username || displayName || '').trim().charAt(0).toUpperCase() || 'A')}`
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
              style={[styles.input, styles.disabledInput]}
              value={displayName}
              editable={false}
              placeholder="Mirrors your username"
              placeholderTextColor="#9ca3af"
              maxLength={50}
            />
            <Text style={styles.helperText}>Display Name always matches Username.</Text>
          </View>

          <View style={styles.inputContainer}>
            <Text style={styles.label}>Username</Text>
            <TextInput
              style={styles.input}
              value={username}
              onChangeText={setUsername}
              placeholder="e.g. alex_26"
              placeholderTextColor="#9ca3af"
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={20}
            />
            <Text style={styles.helperText}>Letters/numbers/underscore/dot (3-20). Shown as @username.</Text>
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
          <TouchableOpacity
            style={styles.optionItem}
            onPress={() => Alert.alert('Coming soon', 'Notification settings are not available yet.')}
          >
            <Icon  name="notifications-outline" size={24} color="#d1d5db"  />
            <Text style={styles.optionText}>Notification Settings</Text>
            <Icon  name="chevron-forward" size={20} color="#9ca3af"  />
          </TouchableOpacity>
          
          <TouchableOpacity
            style={styles.optionItem}
            onPress={() => navigation.navigate('PrivacySettings')}
            accessibilityRole="button"
            accessibilityLabel="Privacy and Security"
          >
            <Icon  name="shield-outline" size={24} color="#d1d5db"  />
            <Text style={styles.optionText}>Privacy & Security</Text>
            <Icon  name="chevron-forward" size={20} color="#9ca3af"  />
          </TouchableOpacity>
          
          <TouchableOpacity
            style={styles.optionItem}
            onPress={() => Alert.alert('Coming soon', 'Help and support are not available yet.')}
          >
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
    backgroundColor: COLORS.pageBackground,
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