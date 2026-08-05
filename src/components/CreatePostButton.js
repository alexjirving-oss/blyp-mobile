import React, { useCallback, useEffect, useState } from 'react';
import Icon from './Icon';
import { TouchableOpacity, StyleSheet, Modal, View, Text, Alert } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../hooks/useCommon';
import { isLiveStreamingEnabled } from '../config/StreamingFeatureFlag';
import { requireAccount } from '../services/guestSessionService';
import { COLORS } from '../styles/theme';

export const COMPOSE_DRAFT_KEY = 'blyp_compose_draft_v1';

const CreatePostButton = () => {
  const navigation = useNavigation();
  const [showMenu, setShowMenu] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);
  const { uid, isAuthenticated, authReady } = useAuth();
  const streamingEnabled = isLiveStreamingEnabled();
  const canShowGoLive = streamingEnabled;

  const refreshDraftFlag = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(COMPOSE_DRAFT_KEY);
      if (!raw) {
        setHasDraft(false);
        return;
      }
      const parsed = JSON.parse(raw);
      const items = Array.isArray(parsed?.mediaItems) ? parsed.mediaItems : [];
      setHasDraft(items.length > 0 || !!(parsed?.caption && String(parsed.caption).trim()));
    } catch {
      setHasDraft(false);
    }
  }, []);

  useEffect(() => {
    if (showMenu) {
      refreshDraftFlag();
    }
  }, [showMenu, refreshDraftFlag]);

  const ensureCanCreate = (actionLabel) => {
    if (!authReady) {
      Alert.alert('Please wait', 'Still loading your account. Please try again in a moment.');
      return false;
    }
    if (!isAuthenticated || !uid) {
      Alert.alert(
        'Login required',
        `You need to be logged in to ${actionLabel}. Please log in and try again.`
      );
      return false;
    }
    return true;
  };

  const handlePress = () => {
    if (requireAccount(navigation, 'post or go live')) return;
    // Dominant path: single tap opens Library (TikTok-class). Long-press opens Create sheet.
    if (!ensureCanCreate('create a post')) return;
    console.log('[POST][ENTRY] Plus tap → Library');
    navigation.navigate('Review', { entryPoint: 'plus_fab', mode: 'library', source: 'gallery' });
  };

  const handleLongPress = () => {
    if (requireAccount(navigation, 'post or go live')) return;
    setShowMenu(true);
  };

  const goReview = (params) => {
    setShowMenu(false);
    if (!ensureCanCreate('create a post')) return;
    console.log('[POST][ENTRY] Navigating to Review from create sheet', params);
    navigation.navigate('Review', { entryPoint: 'plus_menu', ...params });
  };

  const handleResumeDraft = async () => {
    if (!ensureCanCreate('resume a draft')) return;
    try {
      const raw = await AsyncStorage.getItem(COMPOSE_DRAFT_KEY);
      if (!raw) {
        setHasDraft(false);
        return;
      }
      const draft = JSON.parse(raw);
      setShowMenu(false);
      navigation.navigate('Review', {
        entryPoint: 'resume_draft',
        source: draft.source || 'draft',
        media: draft.mediaItems || [],
        type: draft.type || 'photos',
        transcript: draft.caption || '',
        resumeDraft: true,
      });
    } catch (e) {
      console.warn('[POST] resume draft failed', e?.message || e);
      Alert.alert('Draft unavailable', 'Could not open your saved draft.');
    }
  };

  const handleGoLive = () => {
    setShowMenu(false);
    if (!streamingEnabled) {
      Alert.alert('Live streaming disabled', 'Live streaming is currently turned off for this build.');
      return;
    }
    if (!ensureCanCreate('go live')) return;
    navigation.navigate('LiveStreamScreen', {
      mode: 'host',
      source: 'CreatePostButton',
    });
  };

  const handleMenuOption = (option) => {
    if (option === 'live') {
      handleGoLive();
    }
  };

  return (
    <>
      <View style={styles.container}>
        <TouchableOpacity
          style={styles.button}
          onPress={handlePress}
          onLongPress={handleLongPress}
          delayLongPress={350}
          activeOpacity={0.85}
        >
          <View style={styles.fab}>
            <Icon name="add" size={30} color={COLORS.black} />
          </View>
        </TouchableOpacity>
      </View>

      <Modal
        visible={showMenu}
        transparent
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
            <Text style={styles.sheetTitle}>Create</Text>

            {hasDraft ? (
              <TouchableOpacity style={styles.menuItem} onPress={handleResumeDraft}>
                <View style={[styles.menuItemGradient, styles.resumeGradient]}>
                  <View style={styles.row}>
                    <Icon name="document-text-outline" size={20} color={COLORS.primary} />
                    <Text style={[styles.menuItemTextMain, styles.resumeText]}>Resume draft</Text>
                  </View>
                </View>
              </TouchableOpacity>
            ) : null}

            <View style={styles.postOptionsGrid}>
              <TouchableOpacity
                style={styles.postOptionButton}
                onPress={() => goReview({ mode: 'photo', source: 'camera' })}
              >
                <View style={styles.postOptionIconContainer}>
                  <Icon name="camera" size={28} color="#00D2BE" />
                </View>
                <Text style={styles.postOptionText}>Photo</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.postOptionButton}
                onPress={() => goReview({ mode: 'video', source: 'camera' })}
              >
                <View style={styles.postOptionIconContainer}>
                  <Icon name="videocam" size={28} color="#67E8F9" />
                </View>
                <Text style={styles.postOptionText}>Video</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.postOptionButton}
                onPress={() => goReview({ mode: 'library', source: 'gallery' })}
              >
                <View style={styles.postOptionIconContainer}>
                  <Icon name="images" size={28} color="#A78BFA" />
                </View>
                <Text style={styles.postOptionText}>Library</Text>
              </TouchableOpacity>

              {canShowGoLive ? (
                <TouchableOpacity
                  style={styles.postOptionButton}
                  onPress={() => handleMenuOption('live')}
                >
                  <View style={[styles.postOptionIconContainer, styles.liveIconContainer]}>
                    <Icon name="radio-outline" size={28} color="#F87171" />
                  </View>
                  <Text style={styles.postOptionText}>Go Live</Text>
                </TouchableOpacity>
              ) : null}
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
    marginTop: -22,
  },
  button: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fab: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 8,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  menuContainer: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingBottom: 32,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  menuHandle: {
    width: 40,
    height: 5,
    backgroundColor: COLORS.borderStrong,
    borderRadius: 3,
    alignSelf: 'center',
    marginBottom: 12,
  },
  sheetTitle: {
    color: COLORS.textPrimary || '#ffffff',
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 16,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
    paddingHorizontal: 0,
    borderRadius: 16,
    marginBottom: 8,
  },
  menuItemGradient: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 16,
    alignItems: 'center',
    width: '100%',
  },
  resumeGradient: {
    backgroundColor: '#1C1C22',
    borderWidth: 1,
    borderColor: COLORS.borderStrong || '#3F3F46',
  },
  resumeText: {
    color: COLORS.primary,
    marginLeft: 8,
    fontSize: 17,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuItemTextMain: {
    color: 'white',
    fontSize: 18,
    fontWeight: '800',
  },
  postOptionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  postOptionButton: {
    width: '48%',
    alignItems: 'center',
    paddingVertical: 18,
    paddingHorizontal: 12,
    backgroundColor: '#1C1C22',
    borderRadius: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#27272E',
  },
  postOptionIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#0A0A0C',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
    borderWidth: 2,
    borderColor: '#3F3F46',
  },
  liveIconContainer: {
    borderColor: '#7F1D1D',
  },
  postOptionText: {
    color: '#d1d5db',
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
});

export default CreatePostButton;
