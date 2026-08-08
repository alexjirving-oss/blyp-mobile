import React, { useState, useEffect, useMemo, useRef } from 'react';
import ScreenContainer from '../components/ScreenContainer';
import Icon from '../components/Icon';
import { Alert, Image, ScrollView, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import Toast from 'react-native-toast-message';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { doc, getDoc, setDoc, collection, query, where, getDocs, limit as fsLimit } from 'firebase/firestore';
import { storage, firestore as db } from '../config/firebase';
import { useAuth } from '../hooks/useCommon';
import { useHasAI } from '../hooks/useEntitlement';
import BlypLogo from '../components/BlypLogo';
import StandingBadge from '../components/StandingBadge';
import { COLORS } from '../styles/theme';
import {
  BADGE_CATALOG,
  CLUB_CATALOG,
  getProfileIdentityCaps,
  isServerEarnedBadge,
  normalizeEquippableBadges,
  normalizeProfileClubs,
  toggleIdInList,
} from '../services/profileIdentityCatalog';
import { syncClubMembershipIndex } from '../services/clubDiscoveryService';
import { fetchEarnedBadgeIds, syncBadgeAwards } from '../services/badgeAwardsService';
import { setOwnProfileCache } from '../services/ownProfileCache';
import { claimUsername, validateUsername } from '../services/usernameProfileService';
import {
  EXTERNAL_AUTH_PROVIDERS,
  ID_DOCUMENT_TYPES,
  VERIFICATION_STATUS,
  listAvailableExternalProviders,
  normalizeVerificationStatus,
  readCognitoLinkedProviders,
  submitVerification,
  verificationStatusLabel,
} from '../services/verificationService';

const PRONOUN_OPTIONS = ['she/her', 'he/him', 'they/them', 'custom'];

const EditProfileScreen = ({ navigation, route }) => {
  const profileFromRoute = route?.params?.profile ?? route?.params?.user ?? null;
  const { uid, user: authUser, isAuthenticated, hasUser, authReady, getDisplayName } = useAuth();
  const hasPlus = useHasAI();
  const identityCaps = useMemo(() => getProfileIdentityCaps(hasPlus), [hasPlus]);
  const [displayName, setDisplayName] = useState(profileFromRoute?.displayName ?? '');
  const [username, setUsername] = useState(profileFromRoute?.username ?? profileFromRoute?.handle ?? '');
  const [bio, setBio] = useState(profileFromRoute?.bio ?? '');
  const [profileImage, setProfileImage] = useState(profileFromRoute?.photoURL ?? '');
  const [location, setLocation] = useState(profileFromRoute?.location ?? profileFromRoute?.city ?? '');
  const [country, setCountry] = useState(profileFromRoute?.country ?? '');
  const [website, setWebsite] = useState(profileFromRoute?.website ?? '');
  const [pronouns, setPronouns] = useState(profileFromRoute?.pronouns ?? '');
  const [pronounCustom, setPronounCustom] = useState('');
  const [profileClubs, setProfileClubs] = useState(() =>
    normalizeProfileClubs(profileFromRoute?.profileClubs, getProfileIdentityCaps(false).maxClubs)
  );
  const [earnedBadgeIds, setEarnedBadgeIds] = useState(() =>
    Array.isArray(profileFromRoute?.earnedBadgeIds) ? profileFromRoute.earnedBadgeIds : []
  );
  const [profileBadges, setProfileBadges] = useState(() =>
    normalizeEquippableBadges(
      profileFromRoute?.profileBadges,
      profileFromRoute?.earnedBadgeIds,
      getProfileIdentityCaps(false).maxBadges
    )
  );
  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savedProfileClubs, setSavedProfileClubs] = useState(() =>
    normalizeProfileClubs(profileFromRoute?.profileClubs, getProfileIdentityCaps(false).maxClubs)
  );
  const [verificationStatus, setVerificationStatus] = useState(() =>
    normalizeVerificationStatus(profileFromRoute?.verificationStatus, profileFromRoute?.verified)
  );
  const [verificationMethod, setVerificationMethod] = useState(profileFromRoute?.verificationMethod || null);
  const [verificationBusy, setVerificationBusy] = useState(false);
  const [verifyPath, setVerifyPath] = useState('identity'); // identity | external
  const [legalFullName, setLegalFullName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [addressLine2, setAddressLine2] = useState('');
  const [idCity, setIdCity] = useState('');
  const [idRegion, setIdRegion] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [idCountry, setIdCountry] = useState('');
  const [idDocumentType, setIdDocumentType] = useState('passport');
  const [idDocumentLast4, setIdDocumentLast4] = useState('');
  const [selectedProvider, setSelectedProvider] = useState('Google');
  const initialUsernameRef = useRef(
    String(profileFromRoute?.username || profileFromRoute?.handle || '')
      .trim()
      .replace(/^@/, '')
  );

  const externalProviders = useMemo(() => listAvailableExternalProviders(authUser), [authUser]);
  const linkedProviders = useMemo(() => readCognitoLinkedProviders(authUser), [authUser]);
  const profileVerified = verificationStatus === VERIFICATION_STATUS.VERIFIED;

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
          if (userData.username || userData.handle) {
            const loaded = String(userData.username || userData.handle || '').trim().replace(/^@/, '');
            if (loaded && !initialUsernameRef.current) initialUsernameRef.current = loaded;
            setUsername((prev) => prev || (userData.username || userData.handle));
          }
          if (userData.bio) setBio(userData.bio);
          if (userData.photoURL) setProfileImage((prev) => prev || userData.photoURL);
          if (userData.location || userData.city) {
            setLocation(String(userData.location || userData.city || ''));
          }
          if (userData.country) setCountry(String(userData.country));
          if (userData.website) setWebsite(String(userData.website));
          if (userData.pronouns) {
            const p = String(userData.pronouns);
            if (PRONOUN_OPTIONS.includes(p) && p !== 'custom') {
              setPronouns(p);
            } else {
              setPronouns('custom');
              setPronounCustom(p);
            }
          }
          setVerificationStatus(
            normalizeVerificationStatus(userData.verificationStatus, userData.verified || userData.isVerified)
          );
          setVerificationMethod(userData.verificationMethod || null);
          const loadedClubs = normalizeProfileClubs(userData.profileClubs, identityCaps.maxClubs);
          setProfileClubs(loadedClubs);
          setSavedProfileClubs(loadedClubs);
          let earned = Array.isArray(userData.earnedBadgeIds) ? userData.earnedBadgeIds : [];
          try {
            const synced = await syncBadgeAwards();
            if (synced.earned?.length) earned = synced.earned;
            else {
              const fromStore = await fetchEarnedBadgeIds(uid);
              if (fromStore.length) earned = fromStore;
            }
          } catch (badgeErr) {
            console.warn('[EditProfile] badge sync skipped', badgeErr?.message || String(badgeErr));
            try {
              const fromStore = await fetchEarnedBadgeIds(uid);
              if (fromStore.length) earned = fromStore;
            } catch {
              /* keep denorm */
            }
          }
          setEarnedBadgeIds(earned);
          setProfileBadges(
            normalizeEquippableBadges(userData.profileBadges, earned, identityCaps.maxBadges)
          );
        }
      } catch (error) {
        console.error('Error loading user profile:', error);
      } finally {
        setLoading(false);
      }
    };

    loadUserProfile();
    // identityCaps applied after load via trim effect; omit from deps to avoid mid-edit refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, authUser, getDisplayName]);

  // Enforce entitlement caps on selection (Plus → free, or after load with Plus fail-open).
  useEffect(() => {
    setProfileClubs((prev) => normalizeProfileClubs(prev, identityCaps.maxClubs));
    setProfileBadges((prev) =>
      normalizeEquippableBadges(prev, earnedBadgeIds, identityCaps.maxBadges)
    );
  }, [identityCaps.maxClubs, identityCaps.maxBadges, earnedBadgeIds]);

  // Keep displayName synced to username (requirement: always match).
  useEffect(() => {
    const raw = String(username || '').trim();
    const noAt = raw.startsWith('@') ? raw.slice(1) : raw;
    const mirrored = noAt.trim();
    if (mirrored && displayName !== mirrored) {
      setDisplayName(mirrored);
    }
  }, [username, displayName]);

  const resolvedPronouns = useMemo(() => {
    if (pronouns === 'custom') return String(pronounCustom || '').trim().slice(0, 40);
    return String(pronouns || '').trim().slice(0, 40);
  }, [pronouns, pronounCustom]);

  const markVerifiedLocally = (result) => {
    setVerificationStatus(
      normalizeVerificationStatus(result?.verificationStatus, result?.verified)
    );
    setVerificationMethod(result?.verificationMethod || null);
  };

  const handleSubmitIdentityVerification = async () => {
    if (profileVerified || verificationBusy) return;
    setVerificationBusy(true);
    try {
      const result = await submitVerification({
        method: 'identity',
        identity: {
          legalFullName,
          dateOfBirth,
          addressLine1,
          addressLine2,
          city: idCity || location,
          region: idRegion,
          postalCode,
          country: idCountry || country,
          idDocumentType,
          idDocumentLast4,
        },
      });
      markVerifiedLocally(result);
      Toast.show({
        type: 'success',
        text1: 'You are verified',
        text2: 'Dating and running a team are now unlocked.',
        position: 'bottom',
        visibilityTime: 2400,
      });
    } catch (e) {
      Alert.alert('Verification', e?.message || 'Could not submit identity verification.');
    } finally {
      setVerificationBusy(false);
    }
  };

  const handleSubmitExternalVerification = async () => {
    if (profileVerified || verificationBusy) return;
    const provider = selectedProvider || 'Google';
    const linked = linkedProviders.length
      ? linkedProviders
      : readCognitoLinkedProviders(authUser);
    if (!linked.some((p) => String(p).toLowerCase().includes(String(provider).toLowerCase()))) {
      Alert.alert(
        'Link required',
        `Sign in once with ${provider} so Blyp can confirm that authenticator on this account, or submit identity info instead.`,
      );
      return;
    }
    setVerificationBusy(true);
    try {
      const result = await submitVerification({
        method: 'external_auth',
        provider,
        linkedProviders: linked,
      });
      markVerifiedLocally(result);
      Toast.show({
        type: 'success',
        text1: 'You are verified',
        text2: `Linked via ${provider}.`,
        position: 'bottom',
        visibilityTime: 2400,
      });
    } catch (e) {
      Alert.alert('Verification', e?.message || 'Could not verify with that authenticator.');
    } finally {
      setVerificationBusy(false);
    }
  };

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
    const usernameValidation = validateUsername(username, uid);
    const normalizedUsername = usernameValidation.ok ? usernameValidation.username : null;

    if (!normalizedUsername) {
      Alert.alert('Invalid username', usernameValidation.message);
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

      // Save profile data to Firestore using Cognito uid.
      // Never write avatarFrame / feedPriority / earnedBadgeIds / admin fields here.
      const clubsToSave = normalizeProfileClubs(profileClubs, identityCaps.maxClubs);
      const badgesToSave = normalizeEquippableBadges(
        profileBadges,
        earnedBadgeIds,
        identityCaps.maxBadges
      );
      const bioTrimmed = bio.trim();
      const locationTrimmed = String(location || '').trim().slice(0, 80);
      const countryTrimmed = String(country || '').trim().slice(0, 80);
      const websiteTrimmed = String(website || '').trim().slice(0, 160);
      const pronounsTrimmed = resolvedPronouns;
      const userDocRef = doc(db, 'users', uid);
      await claimUsername({
        uid,
        username: normalizedUsername,
        email: resolvedEmail,
        photoURL,
      });
      await setDoc(userDocRef, {
        displayName: normalizedUsername,
        username: normalizedUsername,
        usernameKey: normalizedUsername.toLowerCase(),
        handle: normalizedUsername,
        photoURL: photoURL,
        bio: bioTrimmed,
        email: resolvedEmail,
        location: locationTrimmed,
        city: locationTrimmed,
        country: countryTrimmed,
        website: websiteTrimmed,
        pronouns: pronounsTrimmed,
        profileClubs: clubsToSave,
        profileBadges: badgesToSave,
        updatedAt: new Date(),
      }, { merge: true });

      // Optimistic UI: paint profile + leave immediately. Club index + post
      // author-meta backfill can take many sequential Firestore writes.
      initialUsernameRef.current = normalizedUsername;
      setSavedProfileClubs(clubsToSave);
      try {
        await setOwnProfileCache(uid, {
          basics: {
            displayName: normalizedUsername,
            username: normalizedUsername,
            handle: normalizedUsername,
            photoURL,
            bio: bioTrimmed,
            email: resolvedEmail,
            location: locationTrimmed,
            city: locationTrimmed,
            country: countryTrimmed,
            website: websiteTrimmed,
            pronouns: pronounsTrimmed,
            profileClubs: clubsToSave,
            profileBadges: badgesToSave,
            verified: profileVerified,
            verificationStatus,
          },
        });
      } catch (cacheErr) {
        console.warn('[EditProfile] own profile cache update skipped', cacheErr?.message || String(cacheErr));
      }

      setIsSaving(false);
      setIsUploading(false);
      try {
        Toast.show({
          type: 'success',
          text1: 'Profile saved',
          position: 'bottom',
          visibilityTime: 1800,
        });
      } catch {
        /* ignore */
      }
      try {
        navigation.goBack();
      } catch {
        /* ignore */
      }

      const clubsPrev = savedProfileClubs;
      void (async () => {
        try {
          await syncClubMembershipIndex(uid, clubsToSave, clubsPrev);
        } catch (syncErr) {
          console.warn('[EditProfile] club membership sync skipped', syncErr?.message || String(syncErr));
        }
        try {
          await backfillAuthorMetaOnPosts({
            ownerUserId: uid,
            newDisplayName: normalizedUsername,
            newUsername: normalizedUsername,
            newPhotoURL: photoURL,
          });
          if (legacyUserId) {
            await backfillAuthorMetaOnPosts({
              ownerUserId: legacyUserId,
              newDisplayName: normalizedUsername,
              newUsername: normalizedUsername,
              newPhotoURL: photoURL,
            });
          }
        } catch (backfillErr) {
          console.warn('[EditProfile] background backfill failed', backfillErr?.message || String(backfillErr));
        }
      })();
    } catch (error) {
      console.error('Error updating profile:', error);
      Alert.alert('Error', 'Failed to update profile. Please try again.');
      setIsSaving(false);
      setIsUploading(false);
    }
  };

  return (
    <ScreenContainer>
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="transparent" translucent={true} />
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Icon name="arrow-back" size={24} color="#ffffff" />
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
                <Icon name="camera" size={24} color="#0A0A0C" />
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

            <View style={styles.sectionDivider}>
              <Text style={styles.sectionEyebrow}>ABOUT YOU</Text>
              <Text style={styles.sectionTitle}>Core profile details</Text>
              <Text style={styles.sectionBody}>
                These show on your public profile and help Blyp personalize clubs, Dating, and teams.
              </Text>
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.label}>Pronouns</Text>
              <View style={styles.chipGrid}>
                {PRONOUN_OPTIONS.map((option) => {
                  const selected = pronouns === option;
                  return (
                    <TouchableOpacity
                      key={option}
                      style={[styles.pickChip, selected && styles.pickChipSelected]}
                      onPress={() => setPronouns(option)}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                    >
                      <Text style={[styles.pickChipText, selected && styles.pickChipTextSelected]}>
                        {option === 'custom' ? 'Custom' : option}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {pronouns === 'custom' ? (
                <TextInput
                  style={[styles.input, { marginTop: 10 }]}
                  value={pronounCustom}
                  onChangeText={setPronounCustom}
                  placeholder="e.g. xe/xem"
                  placeholderTextColor="#9ca3af"
                  maxLength={40}
                />
              ) : null}
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.label}>City / location</Text>
              <TextInput
                style={styles.input}
                value={location}
                onChangeText={setLocation}
                placeholder="Where you're based"
                placeholderTextColor="#9ca3af"
                maxLength={80}
              />
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.label}>Country</Text>
              <TextInput
                style={styles.input}
                value={country}
                onChangeText={setCountry}
                placeholder="Country"
                placeholderTextColor="#9ca3af"
                maxLength={80}
              />
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.label}>Website or link</Text>
              <TextInput
                style={styles.input}
                value={website}
                onChangeText={setWebsite}
                placeholder="https://"
                placeholderTextColor="#9ca3af"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                maxLength={160}
              />
              <Text style={styles.helperText}>Optional public link for your profile.</Text>
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.label}>Clubs</Text>
              <Text style={styles.helperText}>
                Join teams and game clubs ({profileClubs.length}/{identityCaps.maxClubs}). Curated catalog only.
              </Text>
              <View style={styles.chipGrid}>
                {CLUB_CATALOG.map((club) => {
                  const selected = profileClubs.includes(club.id);
                  const atCap = !selected && profileClubs.length >= identityCaps.maxClubs;
                  return (
                    <TouchableOpacity
                      key={club.id}
                      style={[
                        styles.pickChip,
                        selected && styles.pickChipSelected,
                        atCap && styles.pickChipDisabled,
                      ]}
                      onPress={() =>
                        setProfileClubs((prev) =>
                          toggleIdInList(prev, club.id, identityCaps.maxClubs)
                        )
                      }
                      disabled={atCap}
                      accessibilityRole="button"
                      accessibilityState={{ selected, disabled: atCap }}
                      accessibilityLabel={`${club.label} club`}
                    >
                      <Icon
                        name={club.icon}
                        size={14}
                        color={selected ? '#00D2BE' : '#9ca3af'}
                      />
                      <Text style={[styles.pickChipText, selected && styles.pickChipTextSelected]}>
                        {club.shortLabel || club.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {!hasPlus && profileClubs.length >= identityCaps.maxClubs ? (
                <TouchableOpacity
                  style={styles.upsellHint}
                  onPress={() => navigation.navigate('Plans')}
                  accessibilityRole="button"
                  accessibilityLabel="Unlock more clubs with Blyp Plus"
                >
                  <Icon name="sparkles" size={14} color="#00D2BE" />
                  <Text style={styles.upsellHintText}>
                    Free plan: {identityCaps.maxClubs} clubs. Blyp Plus unlocks up to 8.
                  </Text>
                  <Icon name="chevron-forward" size={14} color="#00D2BE" />
                </TouchableOpacity>
              ) : null}
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.label}>Badges</Text>
              <Text style={styles.helperText}>
                Equip up to {identityCaps.maxBadges} on your profile ({profileBadges.length}/{identityCaps.maxBadges}).
                Earnable badges unlock after Live Host, Marble Podium, or Early Blyper.
              </Text>
              <View style={styles.chipGrid}>
                {BADGE_CATALOG.map((badge) => {
                  const selected = profileBadges.includes(badge.id);
                  const needsEarn = isServerEarnedBadge(badge.id) && !earnedBadgeIds.includes(badge.id);
                  const atCap = !selected && profileBadges.length >= identityCaps.maxBadges;
                  const disabled = needsEarn || atCap;
                  return (
                    <TouchableOpacity
                      key={badge.id}
                      style={[
                        styles.pickChip,
                        selected && styles.pickChipBadgeSelected,
                        disabled && styles.pickChipDisabled,
                        needsEarn && styles.pickChipLocked,
                      ]}
                      onPress={() => {
                        if (needsEarn) return;
                        setProfileBadges((prev) =>
                          toggleIdInList(prev, badge.id, identityCaps.maxBadges)
                        );
                      }}
                      disabled={disabled}
                      accessibilityRole="button"
                      accessibilityState={{ selected, disabled }}
                      accessibilityLabel={
                        needsEarn
                          ? `${badge.label} badge locked — earn to unlock`
                          : `${badge.label} badge`
                      }
                    >
                      <Icon
                        name={badge.icon}
                        size={14}
                        color={selected ? '#C4B5FD' : needsEarn ? '#6b7280' : '#9ca3af'}
                      />
                      <Text
                        style={[
                          styles.pickChipText,
                          selected && styles.pickChipBadgeTextSelected,
                          needsEarn && styles.pickChipLockedText,
                        ]}
                      >
                        {needsEarn ? `${badge.label} · Earn` : badge.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {!hasPlus && profileBadges.length >= identityCaps.maxBadges ? (
                <TouchableOpacity
                  style={styles.upsellHint}
                  onPress={() => navigation.navigate('Plans')}
                  accessibilityRole="button"
                  accessibilityLabel="Unlock more badges with Blyp Plus"
                >
                  <Icon name="sparkles" size={14} color="#C4B5FD" />
                  <Text style={styles.upsellHintText}>
                    Free plan: {identityCaps.maxBadges} badge. Blyp Plus unlocks up to 3.
                  </Text>
                  <Icon name="chevron-forward" size={14} color="#C4B5FD" />
                </TouchableOpacity>
              ) : null}
            </View>
          </View>

          <View style={styles.verificationSection}>
            <View style={styles.sectionDivider}>
              <Text style={styles.sectionEyebrow}>TRUST</Text>
              <View style={styles.verificationTitleRow}>
                <Text style={styles.sectionTitle}>Verification</Text>
                {profileVerified ? (
                  <StandingBadge
                    profile={{ verified: true }}
                    variant="chip"
                    label="Verified"
                  />
                ) : null}
              </View>
              <Text style={styles.sectionBody}>
                Verified members can use Dating and apply to run their own team. Choose identity
                details or a linked authenticator.
              </Text>
            </View>

            <View
              style={[
                styles.statusCard,
                profileVerified && styles.statusCardVerified,
                verificationStatus === VERIFICATION_STATUS.PENDING && styles.statusCardPending,
                verificationStatus === VERIFICATION_STATUS.REJECTED && styles.statusCardRejected,
              ]}
            >
              <Icon
                name={profileVerified ? 'checkmark-circle' : 'shield-outline'}
                size={22}
                color={profileVerified ? '#34c759' : '#00D2BE'}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.statusTitle}>
                  Status: {verificationStatusLabel(verificationStatus)}
                </Text>
                <Text style={styles.statusBody}>
                  {profileVerified
                    ? `Verified via ${verificationMethod === 'external_auth' ? 'linked authenticator' : 'identity info'}.`
                    : verificationStatus === VERIFICATION_STATUS.REJECTED
                      ? 'Previous submission needs updates. Submit again below.'
                      : 'Unverified — Dating and team ownership stay locked until you verify.'}
                </Text>
              </View>
            </View>

            {!profileVerified ? (
              <>
                <View style={styles.pathRow}>
                  <TouchableOpacity
                    style={[styles.pathChip, verifyPath === 'identity' && styles.pathChipActive]}
                    onPress={() => setVerifyPath('identity')}
                  >
                    <Text
                      style={[
                        styles.pathChipText,
                        verifyPath === 'identity' && styles.pathChipTextActive,
                      ]}
                    >
                      Identity info
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.pathChip, verifyPath === 'external' && styles.pathChipActive]}
                    onPress={() => setVerifyPath('external')}
                  >
                    <Text
                      style={[
                        styles.pathChipText,
                        verifyPath === 'external' && styles.pathChipTextActive,
                      ]}
                    >
                      Link authenticator
                    </Text>
                  </TouchableOpacity>
                </View>

                {verifyPath === 'identity' ? (
                  <View style={styles.verifyForm}>
                    <Text style={styles.helperText}>
                      Legal details stay private for review. Only the verified badge is public.
                    </Text>
                    <Text style={styles.fieldLabel}>Full legal name</Text>
                    <TextInput
                      style={styles.input}
                      value={legalFullName}
                      onChangeText={setLegalFullName}
                      placeholder="Name as on your ID"
                      placeholderTextColor="#9ca3af"
                      maxLength={120}
                    />
                    <Text style={styles.fieldLabel}>Date of birth (YYYY-MM-DD)</Text>
                    <TextInput
                      style={styles.input}
                      value={dateOfBirth}
                      onChangeText={setDateOfBirth}
                      placeholder="1998-04-12"
                      placeholderTextColor="#9ca3af"
                      autoCapitalize="none"
                      maxLength={10}
                    />
                    <Text style={styles.fieldLabel}>Street address</Text>
                    <TextInput
                      style={styles.input}
                      value={addressLine1}
                      onChangeText={setAddressLine1}
                      placeholder="Address line 1"
                      placeholderTextColor="#9ca3af"
                      maxLength={160}
                    />
                    <TextInput
                      style={[styles.input, { marginTop: 8 }]}
                      value={addressLine2}
                      onChangeText={setAddressLine2}
                      placeholder="Address line 2 (optional)"
                      placeholderTextColor="#9ca3af"
                      maxLength={160}
                    />
                    <Text style={styles.fieldLabel}>City</Text>
                    <TextInput
                      style={styles.input}
                      value={idCity}
                      onChangeText={setIdCity}
                      placeholder={location || 'City'}
                      placeholderTextColor="#9ca3af"
                      maxLength={80}
                    />
                    <Text style={styles.fieldLabel}>State / region</Text>
                    <TextInput
                      style={styles.input}
                      value={idRegion}
                      onChangeText={setIdRegion}
                      placeholder="Region"
                      placeholderTextColor="#9ca3af"
                      maxLength={80}
                    />
                    <Text style={styles.fieldLabel}>Postal / ZIP code</Text>
                    <TextInput
                      style={styles.input}
                      value={postalCode}
                      onChangeText={setPostalCode}
                      placeholder="Postal code"
                      placeholderTextColor="#9ca3af"
                      maxLength={32}
                    />
                    <Text style={styles.fieldLabel}>Country</Text>
                    <TextInput
                      style={styles.input}
                      value={idCountry}
                      onChangeText={setIdCountry}
                      placeholder={country || 'Country'}
                      placeholderTextColor="#9ca3af"
                      maxLength={80}
                    />
                    <Text style={styles.fieldLabel}>ID document type</Text>
                    <View style={styles.chipGrid}>
                      {ID_DOCUMENT_TYPES.map((docType) => {
                        const selected = idDocumentType === docType.id;
                        return (
                          <TouchableOpacity
                            key={docType.id}
                            style={[styles.pickChip, selected && styles.pickChipSelected]}
                            onPress={() => setIdDocumentType(docType.id)}
                          >
                            <Text
                              style={[
                                styles.pickChipText,
                                selected && styles.pickChipTextSelected,
                              ]}
                            >
                              {docType.label}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    <Text style={styles.fieldLabel}>Last 4 of ID number</Text>
                    <TextInput
                      style={styles.input}
                      value={idDocumentLast4}
                      onChangeText={setIdDocumentLast4}
                      placeholder="••••"
                      placeholderTextColor="#9ca3af"
                      autoCapitalize="characters"
                      maxLength={4}
                    />
                    <TouchableOpacity
                      style={[styles.verifyButton, verificationBusy && styles.verifyButtonDisabled]}
                      onPress={handleSubmitIdentityVerification}
                      disabled={verificationBusy}
                      accessibilityRole="button"
                      accessibilityLabel="Submit identity verification"
                    >
                      <Text style={styles.verifyButtonText}>
                        {verificationBusy ? 'Submitting…' : 'Submit identity verification'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={styles.verifyForm}>
                    <Text style={styles.helperText}>
                      Use a Google, Apple, or Facebook session already linked on this Cognito account.
                      If nothing is linked yet, sign in with that provider once, then return here — or
                      use identity info instead.
                    </Text>
                    <View style={styles.chipGrid}>
                      {(externalProviders.length ? externalProviders : EXTERNAL_AUTH_PROVIDERS).map(
                        (provider) => {
                          const id = provider.id || provider;
                          const label = provider.label || provider;
                          const linked = !!provider.linked;
                          const selected = selectedProvider === id;
                          return (
                            <TouchableOpacity
                              key={id}
                              style={[
                                styles.pickChip,
                                selected && styles.pickChipSelected,
                                linked && styles.providerLinked,
                              ]}
                              onPress={() => setSelectedProvider(id)}
                            >
                              <Text
                                style={[
                                  styles.pickChipText,
                                  selected && styles.pickChipTextSelected,
                                ]}
                              >
                                {label}
                                {linked ? ' · linked' : ''}
                              </Text>
                            </TouchableOpacity>
                          );
                        }
                      )}
                    </View>
                    <TouchableOpacity
                      style={[styles.verifyButton, verificationBusy && styles.verifyButtonDisabled]}
                      onPress={handleSubmitExternalVerification}
                      disabled={verificationBusy}
                      accessibilityRole="button"
                      accessibilityLabel="Verify with linked authenticator"
                    >
                      <Text style={styles.verifyButtonText}>
                        {verificationBusy ? 'Verifying…' : `Verify with ${selectedProvider}`}
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
              </>
            ) : null}
          </View>
        </ScrollView>
      </View>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#141418',
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '600',
  },
  saveButton: {
    color: '#00D2BE',
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
    paddingVertical: 8,
  },
  imageContainer: {
    position: 'relative',
  },
  profileImage: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 3,
    borderColor: '#3F3F46',
  },
  imageOverlay: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: '#00D2BE',
    borderRadius: 20,
    padding: 8,
    borderWidth: 3,
    borderColor: '#0A0A0C',
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
    backgroundColor: '#141418',
    borderRadius: 12,
    padding: 16,
    color: '#ffffff',
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#3F3F46',
  },
  bioInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  disabledInput: {
    backgroundColor: COLORS.surface,
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
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  pickChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#3F3F46',
    backgroundColor: '#141418',
  },
  pickChipSelected: {
    borderColor: 'rgba(0, 210, 190, 0.55)',
    backgroundColor: 'rgba(0, 210, 190, 0.12)',
  },
  pickChipBadgeSelected: {
    borderColor: 'rgba(196, 181, 253, 0.5)',
    backgroundColor: 'rgba(196, 181, 253, 0.12)',
  },
  pickChipDisabled: {
    opacity: 0.4,
  },
  pickChipLocked: {
    opacity: 0.55,
    borderStyle: 'dashed',
  },
  pickChipLockedText: {
    color: '#9ca3af',
    fontWeight: '500',
  },
  pickChipText: {
    color: '#d1d5db',
    fontSize: 13,
    fontWeight: '600',
  },
  pickChipTextSelected: {
    color: '#E6FFFB',
  },
  pickChipBadgeTextSelected: {
    color: '#F3EEFF',
  },
  upsellHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(0, 210, 190, 0.28)',
    backgroundColor: 'rgba(0, 210, 190, 0.08)',
  },
  upsellHintText: {
    flex: 1,
    color: '#E2E8F0',
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
  },
  sectionDivider: {
    marginTop: 8,
    marginBottom: 16,
  },
  sectionEyebrow: {
    color: '#00D2BE',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.1,
    marginBottom: 6,
  },
  sectionTitle: {
    color: '#f8fafc',
    fontSize: 18,
    fontWeight: '800',
  },
  sectionBody: {
    color: '#9ca3af',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
  },
  verificationSection: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 40,
  },
  verificationTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  statusCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#3F3F46',
    backgroundColor: '#141418',
    marginBottom: 14,
  },
  statusCardVerified: {
    borderColor: 'rgba(52, 199, 89, 0.45)',
    backgroundColor: 'rgba(52, 199, 89, 0.08)',
  },
  statusCardPending: {
    borderColor: 'rgba(245, 166, 35, 0.45)',
    backgroundColor: 'rgba(245, 166, 35, 0.08)',
  },
  statusCardRejected: {
    borderColor: 'rgba(239, 68, 68, 0.45)',
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
  },
  statusTitle: {
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '800',
  },
  statusBody: {
    color: '#9ca3af',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
  },
  pathRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  pathChip: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#3F3F46',
    backgroundColor: '#141418',
    alignItems: 'center',
  },
  pathChipActive: {
    borderColor: 'rgba(0, 210, 190, 0.55)',
    backgroundColor: 'rgba(0, 210, 190, 0.12)',
  },
  pathChipText: {
    color: '#d1d5db',
    fontSize: 13,
    fontWeight: '700',
  },
  pathChipTextActive: {
    color: '#E6FFFB',
  },
  verifyForm: {
    gap: 4,
    paddingBottom: 12,
  },
  fieldLabel: {
    color: '#cbd5e1',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 12,
    marginBottom: 6,
  },
  providerLinked: {
    borderColor: 'rgba(52, 199, 89, 0.4)',
  },
  verifyButton: {
    marginTop: 18,
    backgroundColor: '#00D2BE',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  verifyButtonDisabled: {
    opacity: 0.55,
  },
  verifyButtonText: {
    color: '#001b18',
    fontSize: 15,
    fontWeight: '800',
  },
});

export default EditProfileScreen;


