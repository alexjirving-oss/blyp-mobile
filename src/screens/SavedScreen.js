// SavedScreen.js
//
// The user's saved/bookmarked posts, organized into optional Collections.
// Backed by bookmarkService + collectionsService (AsyncStorage + Firestore
// mirror) so it loads instantly and updates live.

import React, { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Image,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import Icon from '../components/Icon';
import { COLORS } from '../styles/theme';
import { responsiveFont, responsiveSize } from '../utils/scaleUtils';
import { useAuth } from '../hooks/useCommon';
import { subscribeBookmarks, removeBookmark } from '../services/bookmarkService';
import {
  subscribeCollections,
  createCollection,
  deleteCollection,
  toggleInCollection,
} from '../services/collectionsService';
import { fixStorageUrl } from '../utils/urlUtils';

const SavedScreen = ({ navigation }) => {
  const { uid } = useAuth();
  const [items, setItems] = useState([]);
  const [collections, setCollections] = useState([]);
  const [activeId, setActiveId] = useState(null); // null = All
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [addForPost, setAddForPost] = useState(null); // post being filed

  useEffect(() => {
    const u1 = subscribeBookmarks(uid, setItems);
    const u2 = subscribeCollections(uid, setCollections);
    return () => {
      u1();
      u2();
    };
  }, [uid]);

  const activeCollection = collections.find((c) => c.id === activeId) || null;
  const visibleItems = useMemo(() => {
    if (!activeCollection) return items;
    const set = new Set(activeCollection.postIds);
    return items.filter((b) => set.has(b.id));
  }, [items, activeCollection]);

  const openPost = (item) => navigation.navigate('MediaViewer', { post: { ...item } });

  const submitNew = async () => {
    const created = await createCollection(uid, newName);
    setNewName('');
    setNewOpen(false);
    if (created) setActiveId(created.id);
  };

  const renderItem = ({ item }) => {
    const uri = fixStorageUrl(item.thumbnail);
    const isVideo = item.type === 'video';
    return (
      <TouchableOpacity style={styles.card} activeOpacity={0.85} onPress={() => openPost(item)}>
        <View style={styles.thumbWrap}>
          {uri ? (
            <Image source={{ uri }} style={styles.thumb} resizeMode="cover" />
          ) : (
            <View style={[styles.thumb, styles.thumbFallback]}>
              <Icon name="image-outline" size={26} color={COLORS.textMuted} />
            </View>
          )}
          {isVideo && (
            <View style={styles.playBadge}>
              <Icon name="play" size={13} color={COLORS.white} />
            </View>
          )}
          <TouchableOpacity style={styles.folderBtn} onPress={() => setAddForPost(item)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Icon name="folder-outline" size={15} color={COLORS.white} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.removeBtn} onPress={() => removeBookmark(uid, item.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Icon name="bookmark" size={16} color={COLORS.primary} />
          </TouchableOpacity>
        </View>
        <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
        {!!item.username && <Text style={styles.cardUser} numberOfLines={1}>@{item.username}</Text>}
      </TouchableOpacity>
    );
  };

  return (
    <ScreenContainer>
      <View style={styles.container}>
        <View style={styles.topRow}>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Icon name="chevron-back" size={24} color={COLORS.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.title}>Saved</Text>
          <TouchableOpacity style={styles.backBtn} onPress={() => setNewOpen(true)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Icon name="add" size={24} color={COLORS.primary} />
          </TouchableOpacity>
        </View>

        {/* Collection chips */}
        <View style={styles.chipBar}>
          <FlatList
            data={[{ id: null, name: 'All' }, ...collections]}
            keyExtractor={(c) => c.id || 'all'}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
            renderItem={({ item: c }) => {
              const on = activeId === c.id;
              return (
                <TouchableOpacity
                  style={[styles.chip, on && styles.chipOn]}
                  activeOpacity={0.85}
                  onPress={() => setActiveId(c.id)}
                  onLongPress={() => {
                    if (c.id) deleteCollection(uid, c.id);
                    if (activeId === c.id) setActiveId(null);
                  }}
                >
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{c.name}</Text>
                  {c.id && <Text style={[styles.chipCount, on && styles.chipTextOn]}>{c.postIds.length}</Text>}
                </TouchableOpacity>
              );
            }}
            ListFooterComponent={
              <TouchableOpacity style={styles.newChip} activeOpacity={0.85} onPress={() => setNewOpen(true)}>
                <Icon name="add" size={15} color={COLORS.primary} />
                <Text style={styles.newChipText}>New</Text>
              </TouchableOpacity>
            }
          />
        </View>

        {visibleItems.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Icon name="bookmark-outline" size={44} color={COLORS.textMuted} />
            <Text style={styles.emptyText}>{activeCollection ? `Nothing in “${activeCollection.name}” yet` : 'Nothing saved yet'}</Text>
            <Text style={styles.emptySub}>Tap the bookmark on any post to keep it here, then file it into a collection.</Text>
          </View>
        ) : (
          <FlatList
            data={visibleItems}
            keyExtractor={(item) => String(item.id)}
            renderItem={renderItem}
            numColumns={2}
            columnWrapperStyle={styles.row}
            contentContainerStyle={styles.grid}
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>

      {/* Create-collection modal */}
      <Modal visible={newOpen} transparent animationType="fade" onRequestClose={() => setNewOpen(false)}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setNewOpen(false)}>
          <TouchableOpacity activeOpacity={1} style={styles.modalCard}>
            <Text style={styles.modalTitle}>New collection</Text>
            <TextInput
              style={styles.modalInput}
              value={newName}
              onChangeText={setNewName}
              placeholder="e.g. Recipes, Goals, Watch later"
              placeholderTextColor={COLORS.textMuted}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={submitNew}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setNewOpen(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalSave, !newName.trim() && styles.modalSaveDisabled]} onPress={submitNew} disabled={!newName.trim()}>
                <Text style={styles.modalSaveText}>Create</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Add-to-collection modal */}
      <Modal visible={!!addForPost} transparent animationType="slide" onRequestClose={() => setAddForPost(null)}>
        <TouchableOpacity style={styles.sheetBackdrop} activeOpacity={1} onPress={() => setAddForPost(null)}>
          <TouchableOpacity activeOpacity={1} style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.modalTitle}>Add to collection</Text>
            {collections.length === 0 && <Text style={styles.sheetEmpty}>No collections yet — create one below.</Text>}
            <View style={{ maxHeight: 280 }}>
              <FlatList
                data={collections}
                keyExtractor={(c) => c.id}
                renderItem={({ item: c }) => {
                  const inIt = addForPost ? c.postIds.includes(addForPost.id) : false;
                  return (
                    <TouchableOpacity
                      style={styles.sheetRow}
                      activeOpacity={0.85}
                      onPress={() => addForPost && toggleInCollection(uid, c.id, addForPost.id)}
                    >
                      <Icon name={inIt ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={inIt ? COLORS.primary : COLORS.textMuted} />
                      <Text style={styles.sheetRowText}>{c.name}</Text>
                      <Text style={styles.sheetRowCount}>{c.postIds.length}</Text>
                    </TouchableOpacity>
                  );
                }}
              />
            </View>
            <TouchableOpacity
              style={styles.sheetNew}
              onPress={() => {
                setAddForPost(null);
                setNewOpen(true);
              }}
            >
              <Icon name="add" size={18} color={COLORS.primary} />
              <Text style={styles.sheetNewText}>New collection</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.sheetDone} onPress={() => setAddForPost(null)}>
              <Text style={styles.sheetDoneText}>Done</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: responsiveSize(8) },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, marginBottom: 8 },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { color: COLORS.textPrimary, fontSize: responsiveFont(18), fontWeight: '800' },

  chipBar: { marginBottom: 6 },
  chipRow: { gap: 8, paddingHorizontal: 14, paddingVertical: 4 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: COLORS.backgroundCard,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chipOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipText: { color: COLORS.textSecondary, fontSize: responsiveFont(13), fontWeight: '700' },
  chipTextOn: { color: COLORS.black },
  chipCount: { color: COLORS.textMuted, fontSize: responsiveFont(11), fontWeight: '700' },
  newChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(0,210,190,0.4)',
    backgroundColor: 'rgba(0,210,190,0.08)',
    marginLeft: 4,
  },
  newChipText: { color: COLORS.primary, fontSize: responsiveFont(13), fontWeight: '700' },

  grid: { paddingHorizontal: 12, paddingBottom: 120, paddingTop: 6 },
  row: { justifyContent: 'space-between' },
  card: { width: '48%', marginBottom: 16 },
  thumbWrap: { position: 'relative', width: '100%', aspectRatio: 1, borderRadius: 12, overflow: 'hidden' },
  thumb: { width: '100%', height: '100%', backgroundColor: COLORS.surface },
  thumbFallback: { alignItems: 'center', justifyContent: 'center' },
  playBadge: { position: 'absolute', bottom: 8, left: 8, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  folderBtn: { position: 'absolute', top: 8, left: 8, width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  removeBtn: { position: 'absolute', top: 8, right: 8, width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  cardTitle: { color: COLORS.textSecondary, fontSize: responsiveFont(13), marginTop: 6, lineHeight: responsiveFont(18) },
  cardUser: { color: COLORS.textMuted, fontSize: responsiveFont(12), marginTop: 2 },

  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 10 },
  emptyText: { color: COLORS.textPrimary, fontSize: responsiveFont(16), fontWeight: '700', textAlign: 'center' },
  emptySub: { color: COLORS.textMuted, fontSize: responsiveFont(13), textAlign: 'center', lineHeight: responsiveFont(19) },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  modalCard: { width: '100%', backgroundColor: COLORS.backgroundCard, borderRadius: 18, padding: 20, borderWidth: 1, borderColor: COLORS.border },
  modalTitle: { color: COLORS.textPrimary, fontSize: responsiveFont(17), fontWeight: '800', marginBottom: 14 },
  modalInput: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 48,
    color: COLORS.textPrimary,
    fontSize: responsiveFont(15),
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 16 },
  modalCancel: { paddingHorizontal: 16, paddingVertical: 10 },
  modalCancelText: { color: COLORS.textSecondary, fontSize: responsiveFont(14), fontWeight: '700' },
  modalSave: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10, backgroundColor: COLORS.primary },
  modalSaveDisabled: { opacity: 0.4 },
  modalSaveText: { color: COLORS.black, fontSize: responsiveFont(14), fontWeight: '800' },

  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: COLORS.backgroundCard, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 32 },
  sheetHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: COLORS.border, marginBottom: 14 },
  sheetEmpty: { color: COLORS.textMuted, fontSize: responsiveFont(13), marginBottom: 8 },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13 },
  sheetRowText: { flex: 1, color: COLORS.textPrimary, fontSize: responsiveFont(15), fontWeight: '600' },
  sheetRowCount: { color: COLORS.textMuted, fontSize: responsiveFont(13) },
  sheetNew: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 14 },
  sheetNewText: { color: COLORS.primary, fontSize: responsiveFont(15), fontWeight: '700' },
  sheetDone: { marginTop: 6, height: 50, borderRadius: 14, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  sheetDoneText: { color: COLORS.black, fontSize: responsiveFont(15), fontWeight: '800' },
});

export default SavedScreen;
