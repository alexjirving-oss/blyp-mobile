/**
 * Edit Stage — owner customization. Preview uses the same StageView visitors see.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Image,
  ActivityIndicator,
  Alert,
  Switch,
  StatusBar,
  useWindowDimensions,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { collection, doc, getDoc, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { firestore as db, storage } from '../config/firebase';
import { useAuth } from '../hooks/useCommon';
import Icon from '../components/Icon';
import ScreenContainer from '../components/ScreenContainer';
import StageView from '../components/stage/StageView';
import {
  STAGE_CONTENT_MAX,
  STAGE_DISPLAY_NAME_MAX,
  STAGE_LINK_LABEL_MAX,
  STAGE_MAX_LINKS,
  STAGE_MAX_PINS,
  STAGE_MAX_TOP_CIRCLE,
  STAGE_THEME_PACKS,
  STAGE_VIBE_MAX,
  STAGE_WALLPAPERS,
} from '../services/stageCatalog';
import {
  buildStageModel,
  defaultStageConfig,
  normalizeStageConfig,
  sanitizeStageUrl,
  saveStageConfig,
} from '../services/stageService';
import { getFollowingIds } from '../utils/followUtils';
import { hydrateOwnProfile } from '../services/ownProfileCache';
import Toast from 'react-native-toast-message';

const emptyLinkDraft = () => ({ id: `draft_${Date.now()}`, label: '', url: '' });

export default function EditStageScreen({ navigation }) {
  const { uid } = useAuth();
  const { width: winW } = useWindowDimensions();
  const contentWidth = Math.min(winW, STAGE_CONTENT_MAX);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [userData, setUserData] = useState(null);
  const [cfg, setCfg] = useState(defaultStageConfig());
  const [followingPeople, setFollowingPeople] = useState([]);
  const [ownPosts, setOwnPosts] = useState([]);
  const [previewMode, setPreviewMode] = useState(false);
  const [coverLocalUri, setCoverLocalUri] = useState(null);

  const load = useCallback(async () => {
    if (!uid) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const snap = await getDoc(doc(db, 'users', uid));
      const data = snap.exists() ? snap.data() : {};
      setUserData(data);
      setCfg(normalizeStageConfig(data.stage));

      const followingIds = await getFollowingIds(uid);
      const people = [];
      for (const id of followingIds.slice(0, 60)) {
        try {
          const pSnap = await getDoc(doc(db, 'users', id));
          if (!pSnap.exists()) continue;
          const p = pSnap.data() || {};
          people.push({
            userId: id,
            username: p.username || p.handle || '',
            displayName: p.displayName || p.username || p.handle || 'User',
            photoURL: p.photoURL || p.avatar || null,
          });
        } catch {
          /* skip */
        }
      }
      setFollowingPeople(people);

      const postsQ = query(
        collection(db, 'posts'),
        where('userId', '==', uid),
        orderBy('date', 'desc'),
        limit(40),
      );
      const postsSnap = await getDocs(postsQ);
      setOwnPosts(postsSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (e) {
      console.error('[EditStage] load failed', e);
      Alert.alert('Could not load Stage', e?.message || 'Please try again.');
    } finally {
      setLoading(false);
    }
  }, [uid]);

  useEffect(() => {
    load();
  }, [load]);

  const previewModel = useMemo(() => {
    const stage = {
      ...cfg,
      coverUrl: coverLocalUri || cfg.coverUrl,
    };
    return buildStageModel(uid, userData || {}, stage);
  }, [cfg, coverLocalUri, uid, userData]);

  const topCirclePeople = useMemo(() => {
    const map = new Map(followingPeople.map((p) => [p.userId, p]));
    return (cfg.topCircle || []).map((id) => map.get(id)).filter(Boolean);
  }, [cfg.topCircle, followingPeople]);

  const pinnedPosts = useMemo(() => {
    const map = new Map(ownPosts.map((p) => [p.id, p]));
    return (cfg.pinnedPostIds || []).map((id) => map.get(id)).filter(Boolean);
  }, [cfg.pinnedPostIds, ownPosts]);

  const pickCover = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission required', 'Please grant photo library access.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [16, 9],
        quality: 0.85,
      });
      if (!result.canceled && result.assets?.[0]?.uri) {
        setCoverLocalUri(result.assets[0].uri);
        setCfg((prev) => ({ ...prev, coverWallpaperId: null }));
      }
    } catch (e) {
      Alert.alert('Error', 'Failed to select cover image');
    }
  };

  const uploadCoverIfNeeded = async () => {
    if (!coverLocalUri || !uid) return cfg.coverUrl;
    const response = await fetch(coverLocalUri);
    const blob = await response.blob();
    const fileName = `${uid}-stage-cover-${Date.now()}.jpg`;
    const storageRef = ref(storage, `users/${uid}/stage/${fileName}`);
    await uploadBytes(storageRef, blob);
    return getDownloadURL(storageRef);
  };

  const toggleCircle = (userId) => {
    setCfg((prev) => {
      const have = new Set(prev.topCircle || []);
      if (have.has(userId)) have.delete(userId);
      else if (have.size < STAGE_MAX_TOP_CIRCLE) have.add(userId);
      else {
        Toast.show({ type: 'info', text1: `Top Circle max is ${STAGE_MAX_TOP_CIRCLE}`, position: 'bottom' });
        return prev;
      }
      return { ...prev, topCircle: Array.from(have) };
    });
  };

  const togglePin = (postId) => {
    setCfg((prev) => {
      const list = [...(prev.pinnedPostIds || [])];
      const idx = list.indexOf(postId);
      if (idx >= 0) list.splice(idx, 1);
      else if (list.length < STAGE_MAX_PINS) list.push(postId);
      else {
        Toast.show({ type: 'info', text1: `You can pin up to ${STAGE_MAX_PINS} posts`, position: 'bottom' });
        return prev;
      }
      return { ...prev, pinnedPostIds: list };
    });
  };

  const updateLink = (index, patch) => {
    setCfg((prev) => {
      const links = [...(prev.links || [])];
      links[index] = { ...links[index], ...patch };
      return { ...prev, links };
    });
  };

  const addLink = () => {
    setCfg((prev) => {
      if ((prev.links || []).length >= STAGE_MAX_LINKS) {
        Toast.show({ type: 'info', text1: `Max ${STAGE_MAX_LINKS} links`, position: 'bottom' });
        return prev;
      }
      return { ...prev, links: [...(prev.links || []), emptyLinkDraft()] };
    });
  };

  const removeLink = (index) => {
    setCfg((prev) => ({
      ...prev,
      links: (prev.links || []).filter((_, i) => i !== index),
    }));
  };

  const onSave = async () => {
    if (!uid || saving) return;
    try {
      setSaving(true);
      const coverUrl = await uploadCoverIfNeeded();
      const links = (cfg.links || [])
        .map((l, i) => {
          const url = sanitizeStageUrl(l.url);
          if (!url) return null;
          return {
            id: l.id || `lnk_${i}`,
            label: String(l.label || `Link ${i + 1}`).trim().slice(0, STAGE_LINK_LABEL_MAX),
            url,
          };
        })
        .filter(Boolean);

      const next = await saveStageConfig(uid, {
        ...cfg,
        coverUrl: coverUrl || null,
        links,
      });
      setCfg(next);
      setCoverLocalUri(null);
      try {
        await hydrateOwnProfile(uid);
      } catch {
        /* ignore */
      }
      Toast.show({ type: 'success', text1: 'Stage saved', position: 'bottom' });
      navigation.goBack();
    } catch (e) {
      console.error('[EditStage] save failed', e);
      Alert.alert('Could not save Stage', e?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <ScreenContainer>
        <SafeAreaView style={styles.container}>
          <View style={styles.loadingBox}>
            <ActivityIndicator color="#FF2D55" size="large" />
            <Text style={styles.loadingText}>Loading Stage…</Text>
          </View>
        </SafeAreaView>
      </ScreenContainer>
    );
  }

  if (previewMode) {
    return (
      <ScreenContainer>
        <SafeAreaView style={styles.container}>
          <StatusBar barStyle="light-content" />
          <View style={styles.header}>
            <TouchableOpacity onPress={() => setPreviewMode(false)} style={styles.headerBtn}>
              <Icon name="arrow-back" size={22} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Stage preview</Text>
            <TouchableOpacity onPress={onSave} style={styles.headerBtn} disabled={saving}>
              {saving ? <ActivityIndicator color="#FF2D55" /> : <Text style={styles.saveText}>Save</Text>}
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
            <StageView
              model={previewModel}
              mode="preview"
              contentWidth={contentWidth}
              topCirclePeople={topCirclePeople}
              pinnedPosts={pinnedPosts}
              followerCount={0}
              followingCount={0}
              postCount={ownPosts.length}
            />
          </ScrollView>
        </SafeAreaView>
      </ScreenContainer>
    );
  }

  const theme = previewModel.theme;

  return (
    <ScreenContainer>
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" />
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBtn}>
            <Icon name="close" size={22} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Edit Stage</Text>
          <TouchableOpacity onPress={onSave} style={styles.headerBtn} disabled={saving}>
            {saving ? <ActivityIndicator color="#FF2D55" /> : <Text style={styles.saveText}>Save</Text>}
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, { maxWidth: STAGE_CONTENT_MAX, width: contentWidth }]}
          keyboardShouldPersistTaps="handled"
        >
          <TouchableOpacity style={styles.previewCta} onPress={() => setPreviewMode(true)} activeOpacity={0.88}>
            <LinearGradient colors={['#FF2D55', '#E01E45']} style={styles.previewCtaGrad}>
              <Icon name="eye-outline" size={18} color="#0A0A0C" />
              <Text style={styles.previewCtaText}>Preview Stage</Text>
            </LinearGradient>
          </TouchableOpacity>

          <Text style={styles.sectionTitle}>Cover</Text>
          <TouchableOpacity onPress={pickCover} activeOpacity={0.9} style={styles.coverPicker}>
            {coverLocalUri || cfg.coverUrl ? (
              <Image source={{ uri: coverLocalUri || cfg.coverUrl }} style={styles.coverPreview} />
            ) : (
              <LinearGradient
                colors={theme?.colors?.coverFallback || ['#0A0A0C', '#FF2D55']}
                style={styles.coverPreview}
              />
            )}
            <View style={styles.coverOverlay}>
              <Icon name="camera" size={20} color="#fff" />
              <Text style={styles.coverOverlayText}>Upload cover</Text>
            </View>
          </TouchableOpacity>

          <Text style={[styles.sectionTitle, { marginTop: 8 }]}>Or wallpaper</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hRow}>
            {STAGE_WALLPAPERS.map((w) => {
              const selected = cfg.coverWallpaperId === w.id && !coverLocalUri;
              return (
                <TouchableOpacity
                  key={w.id}
                  onPress={() => {
                    setCoverLocalUri(null);
                    setCfg((prev) => ({
                      ...prev,
                      coverWallpaperId: w.id,
                      coverUrl: null,
                      themeId: prev.themeId || w.themeHint,
                    }));
                  }}
                  style={[styles.wallCard, selected && { borderColor: '#FF2D55' }]}
                >
                  <LinearGradient colors={w.colors} style={styles.wallSwatch} />
                  <Text style={styles.wallLabel}>{w.label}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <Text style={styles.sectionTitle}>Theme pack</Text>
          <Text style={styles.hint}>Curated skins only — no custom CSS.</Text>
          {STAGE_THEME_PACKS.map((pack) => {
            const selected = cfg.themeId === pack.id;
            return (
              <TouchableOpacity
                key={pack.id}
                style={[styles.themeRow, selected && { borderColor: pack.colors.accent }]}
                onPress={() => setCfg((prev) => ({ ...prev, themeId: pack.id }))}
              >
                <View style={[styles.themeSwatch, { backgroundColor: pack.colors.accent }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.themeLabel}>{pack.label}</Text>
                  <Text style={styles.themeSub}>{pack.subtitle}</Text>
                </View>
                {selected ? <Icon name="checkmark-circle" size={22} color={pack.colors.accent} /> : null}
              </TouchableOpacity>
            );
          })}

          <Text style={styles.sectionTitle}>Stage name</Text>
          <Text style={styles.hint}>Optional short name. @{userData?.username || 'username'} stays your handle.</Text>
          <TextInput
            style={styles.input}
            value={cfg.displayName}
            onChangeText={(t) => setCfg((prev) => ({ ...prev, displayName: t.slice(0, STAGE_DISPLAY_NAME_MAX) }))}
            placeholder="e.g. Night Shift"
            placeholderTextColor="#6b7280"
            maxLength={STAGE_DISPLAY_NAME_MAX}
          />

          <Text style={styles.sectionTitle}>Vibe line</Text>
          <TextInput
            style={styles.input}
            value={cfg.vibe}
            onChangeText={(t) => setCfg((prev) => ({ ...prev, vibe: t.slice(0, STAGE_VIBE_MAX) }))}
            placeholder="One-line mood for your Stage"
            placeholderTextColor="#6b7280"
            maxLength={STAGE_VIBE_MAX}
          />

          <Text style={styles.sectionTitle}>Links</Text>
          <Text style={styles.hint}>Up to {STAGE_MAX_LINKS}. Visitors confirm before leaving the app.</Text>
          {(cfg.links || []).map((link, index) => (
            <View key={link.id || index} style={styles.linkEditor}>
              <TextInput
                style={styles.input}
                value={link.label}
                onChangeText={(t) => updateLink(index, { label: t.slice(0, STAGE_LINK_LABEL_MAX) })}
                placeholder="Label"
                placeholderTextColor="#6b7280"
              />
              <TextInput
                style={styles.input}
                value={link.url}
                onChangeText={(t) => updateLink(index, { url: t })}
                placeholder="https://…"
                placeholderTextColor="#6b7280"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity onPress={() => removeLink(index)} style={styles.removeLink}>
                <Text style={styles.removeLinkText}>Remove</Text>
              </TouchableOpacity>
            </View>
          ))}
          <TouchableOpacity style={styles.secondaryBtn} onPress={addLink}>
            <Text style={styles.secondaryBtnText}>Add link</Text>
          </TouchableOpacity>

          <Text style={styles.sectionTitle}>Top Circle</Text>
          <Text style={styles.hint}>
            Feature up to {STAGE_MAX_TOP_CIRCLE} people you follow ({(cfg.topCircle || []).length}/{STAGE_MAX_TOP_CIRCLE}).
          </Text>
          {followingPeople.length === 0 ? (
            <Text style={styles.emptyHint}>Follow people to feature them here.</Text>
          ) : (
            <View style={styles.chipWrap}>
              {followingPeople.map((p) => {
                const on = (cfg.topCircle || []).includes(p.userId);
                return (
                  <TouchableOpacity
                    key={p.userId}
                    style={[styles.personChip, on && styles.personChipOn]}
                    onPress={() => toggleCircle(p.userId)}
                  >
                    {p.photoURL ? (
                      <Image source={{ uri: p.photoURL }} style={styles.personChipAvatar} />
                    ) : (
                      <View style={[styles.personChipAvatar, styles.personChipAvatarFallback]}>
                        <Icon name="person" size={12} color="#9ca3af" />
                      </View>
                    )}
                    <Text style={styles.personChipText} numberOfLines={1}>
                      {p.displayName || p.username}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          <Text style={styles.sectionTitle}>Pinned showcase</Text>
          <Text style={styles.hint}>
            Pin up to {STAGE_MAX_PINS} of your posts ({(cfg.pinnedPostIds || []).length}/{STAGE_MAX_PINS}).
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hRow}>
            {ownPosts.map((post) => {
              const on = (cfg.pinnedPostIds || []).includes(post.id);
              const thumb = post.thumbnail || post.thumbnailUrl || post.imageUrl || post.media?.[0]?.url;
              return (
                <TouchableOpacity
                  key={post.id}
                  style={[styles.pinPick, on && { borderColor: '#FF2D55' }]}
                  onPress={() => togglePin(post.id)}
                >
                  {thumb ? (
                    <Image source={{ uri: thumb }} style={styles.pinPickImg} />
                  ) : (
                    <View style={[styles.pinPickImg, styles.pinPickFallback]}>
                      <Icon name="image" size={18} color="#6b7280" />
                    </View>
                  )}
                  {on ? (
                    <View style={styles.pinCheck}>
                      <Icon name="checkmark" size={14} color="#0A0A0C" />
                    </View>
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          {!ownPosts.length ? <Text style={styles.emptyHint}>Post something to pin it on your Stage.</Text> : null}

          <Text style={styles.sectionTitle}>Modules</Text>
          {[
            ['about', 'About'],
            ['links', 'Links'],
            ['topCircle', 'Top Circle'],
            ['showcase', 'Pinned showcase'],
          ].map(([key, label]) => (
            <View key={key} style={styles.switchRow}>
              <Text style={styles.switchLabel}>{label}</Text>
              <Switch
                value={cfg.modules?.[key] !== false}
                onValueChange={(v) =>
                  setCfg((prev) => ({
                    ...prev,
                    modules: { ...prev.modules, [key]: v },
                  }))
                }
                trackColor={{ false: '#27272E', true: '#E01E45' }}
                thumbColor="#fff"
              />
            </View>
          ))}

          <View style={styles.switchRow}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={styles.switchLabel}>Show past lives on Stage</Text>
              <Text style={styles.hint}>Owner opt-in. Visitors only see them when enabled.</Text>
            </View>
            <Switch
              value={cfg.showPastLives === true}
              onValueChange={(v) => setCfg((prev) => ({ ...prev, showPastLives: v }))}
              trackColor={{ false: '#27272E', true: '#E01E45' }}
              thumbColor="#fff"
            />
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0C', alignItems: 'center' },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: '#9ca3af', marginTop: 12 },
  header: {
    width: '100%',
    maxWidth: STAGE_CONTENT_MAX,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#27272E',
  },
  headerBtn: { minWidth: 64, padding: 8, alignItems: 'center' },
  headerTitle: { color: '#fff', fontSize: 17, fontWeight: '700' },
  saveText: { color: '#FF2D55', fontWeight: '700', fontSize: 16 },
  scroll: { flex: 1, width: '100%' },
  scrollContent: { alignSelf: 'center', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 48 },
  previewCta: { borderRadius: 14, overflow: 'hidden', marginBottom: 18 },
  previewCtaGrad: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
  },
  previewCtaText: { color: '#FFFFFF', fontWeight: '800', fontSize: 15 },
  sectionTitle: {
    color: '#F5F5F7',
    fontSize: 16,
    fontWeight: '700',
    marginTop: 18,
    marginBottom: 6,
  },
  hint: { color: '#9ca3af', fontSize: 12, marginBottom: 10, lineHeight: 17 },
  coverPicker: {
    height: 140,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#27272E',
  },
  coverPreview: { width: '100%', height: '100%' },
  coverOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  coverOverlayText: { color: '#fff', fontWeight: '700' },
  hRow: { gap: 10, paddingVertical: 4 },
  wallCard: {
    width: 108,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#27272E',
    overflow: 'hidden',
  },
  wallSwatch: { height: 56, width: '100%' },
  wallLabel: { color: '#d1d5db', fontSize: 11, padding: 6, fontWeight: '600' },
  themeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#27272E',
    backgroundColor: '#141418',
    marginBottom: 8,
  },
  themeSwatch: { width: 28, height: 28, borderRadius: 8 },
  themeLabel: { color: '#fff', fontWeight: '700', fontSize: 14 },
  themeSub: { color: '#9ca3af', fontSize: 12, marginTop: 2 },
  input: {
    backgroundColor: '#141418',
    borderWidth: 1,
    borderColor: '#27272E',
    borderRadius: 12,
    color: '#fff',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    marginBottom: 8,
  },
  linkEditor: {
    backgroundColor: '#101014',
    borderRadius: 14,
    padding: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#27272E',
  },
  removeLink: { alignSelf: 'flex-end', padding: 6 },
  removeLinkText: { color: '#FB7185', fontWeight: '600' },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: '#FF2D55',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 8,
  },
  secondaryBtnText: { color: '#FF2D55', fontWeight: '700' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  personChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#27272E',
    backgroundColor: '#141418',
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 10,
    maxWidth: '48%',
  },
  personChipOn: { borderColor: '#FF2D55', backgroundColor: 'rgba(255, 45, 85,0.12)' },
  personChipAvatar: { width: 22, height: 22, borderRadius: 11 },
  personChipAvatarFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#27272E' },
  personChipText: { color: '#F5F5F7', fontSize: 12, fontWeight: '600', flexShrink: 1 },
  pinPick: {
    width: 84,
    height: 112,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#27272E',
  },
  pinPickImg: { width: '100%', height: '100%' },
  pinPickFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#141418' },
  pinCheck: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#FF2D55',
    alignItems: 'center',
    justifyContent: 'center',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#27272E',
  },
  switchLabel: { color: '#F5F5F7', fontSize: 15, fontWeight: '600' },
  emptyHint: { color: '#6b7280', fontSize: 13, marginBottom: 8 },
});
