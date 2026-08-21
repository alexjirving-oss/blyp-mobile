import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Icon from './Icon';
import { COLORS } from '../styles/theme';
import { db, firebaseEnabled } from '../config/firebase';
import {
  MAX_PROFILE_CATEGORIES,
  makeCategoryId,
  normalizeCategoryLabel,
  normalizeProfileCategories,
} from '../utils/profileCategories';

/**
 * Owner sheet: create / rename / reorder / delete profile post categories.
 */
export default function ManageProfileCategoriesSheet({
  visible,
  onClose,
  userId,
  initialCategories = [],
  onSaved,
}) {
  const [categories, setCategories] = useState(() => normalizeProfileCategories(initialCategories));
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editingLabel, setEditingLabel] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setCategories(normalizeProfileCategories(initialCategories));
    setDraft('');
    setEditingId(null);
    setEditingLabel('');
  }, [visible, initialCategories]);

  const addCategory = () => {
    const label = normalizeCategoryLabel(draft);
    if (!label) return;
    if (categories.length >= MAX_PROFILE_CATEGORIES) {
      Alert.alert('Limit reached', `You can have up to ${MAX_PROFILE_CATEGORIES} categories.`);
      return;
    }
    if (categories.some((c) => c.label.toLowerCase() === label.toLowerCase())) {
      Alert.alert('Already exists', 'That category name is already on your list.');
      return;
    }
    setCategories((prev) => [
      ...prev,
      { id: makeCategoryId(label), label, order: prev.length },
    ]);
    setDraft('');
  };

  const commitRename = () => {
    if (!editingId) return;
    const label = normalizeCategoryLabel(editingLabel);
    if (!label) {
      setEditingId(null);
      return;
    }
    setCategories((prev) => prev.map((c) => (c.id === editingId ? { ...c, label } : c)));
    setEditingId(null);
    setEditingLabel('');
  };

  const moveCategory = (id, dir) => {
    setCategories((prev) => {
      const list = [...prev];
      const idx = list.findIndex((c) => c.id === id);
      if (idx < 0) return prev;
      const next = idx + dir;
      if (next < 0 || next >= list.length) return prev;
      const tmp = list[idx];
      list[idx] = list[next];
      list[next] = tmp;
      return list.map((c, i) => ({ ...c, order: i }));
    });
  };

  const deleteCategory = (id) => {
    Alert.alert(
      'Delete category',
      'Posts in this category stay on your profile under Other until you reassign them.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () =>
            setCategories((prev) =>
              prev.filter((c) => c.id !== id).map((c, i) => ({ ...c, order: i })),
            ),
        },
      ],
    );
  };

  const save = async () => {
    if (!userId || !firebaseEnabled || !db || typeof db.collection !== 'function') {
      Alert.alert('Unavailable', 'Could not save categories right now.');
      return;
    }
    setSaving(true);
    try {
      const next = normalizeProfileCategories(categories).map((c, i) => ({
        id: c.id,
        label: c.label,
        order: i,
      }));
      await db.collection('users').doc(userId).set({ profileCategories: next }, { merge: true });
      onSaved?.(next);
      onClose?.();
    } catch (e) {
      Alert.alert('Save failed', e?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.root}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Post categories</Text>
            <TouchableOpacity onPress={onClose} hitSlop={12}>
              <Icon name="close" size={22} color="#fff" />
            </TouchableOpacity>
          </View>
          <Text style={styles.hint}>
            Add shelves at the top of your profile so people can browse by topic.
          </Text>

          <View style={styles.addRow}>
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={setDraft}
              placeholder="e.g. Football, Cooking, Travel"
              placeholderTextColor="rgba(255,255,255,0.35)"
              maxLength={24}
              onSubmitEditing={addCategory}
              returnKeyType="done"
            />
            <TouchableOpacity style={styles.addBtn} onPress={addCategory}>
              <Icon name="add" size={20} color="#0A0A0C" />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 20 }}>
            {categories.length === 0 ? (
              <Text style={styles.empty}>No categories yet. Add your first topic above.</Text>
            ) : (
              categories.map((c, index) => (
                <View key={c.id} style={styles.row}>
                  {editingId === c.id ? (
                    <TextInput
                      style={[styles.input, styles.rowInput]}
                      value={editingLabel}
                      onChangeText={setEditingLabel}
                      autoFocus
                      onBlur={commitRename}
                      onSubmitEditing={commitRename}
                      maxLength={24}
                    />
                  ) : (
                    <TouchableOpacity
                      style={styles.rowMain}
                      onPress={() => {
                        setEditingId(c.id);
                        setEditingLabel(c.label);
                      }}
                    >
                      <Text style={styles.rowLabel}>{c.label}</Text>
                      <Text style={styles.rowHint}>Tap to rename</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={styles.iconBtn}
                    disabled={index === 0}
                    onPress={() => moveCategory(c.id, -1)}
                  >
                    <Icon name="chevron-up" size={18} color={index === 0 ? 'rgba(255,255,255,0.25)' : '#fff'} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.iconBtn}
                    disabled={index === categories.length - 1}
                    onPress={() => moveCategory(c.id, 1)}
                  >
                    <Icon
                      name="chevron-down"
                      size={18}
                      color={index === categories.length - 1 ? 'rgba(255,255,255,0.25)' : '#fff'}
                    />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.iconBtn} onPress={() => deleteCategory(c.id)}>
                    <Icon name="trash" size={16} color="#FB7185" />
                  </TouchableOpacity>
                </View>
              ))
            )}
          </ScrollView>

          <TouchableOpacity style={styles.saveBtn} onPress={save} disabled={saving}>
            {saving ? (
              <ActivityIndicator color="#0A0A0C" />
            ) : (
              <Text style={styles.saveText}>Save categories</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    backgroundColor: '#121214',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 28,
    maxHeight: '78%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  title: { color: '#fff', fontSize: 18, fontWeight: '800' },
  hint: { color: 'rgba(255,255,255,0.5)', fontSize: 13, marginBottom: 14, lineHeight: 18 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  input: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    paddingHorizontal: 12,
    color: '#fff',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  rowInput: { marginRight: 6 },
  addBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
  },
  list: { flexGrow: 0 },
  empty: { color: 'rgba(255,255,255,0.45)', fontSize: 13, paddingVertical: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  rowMain: { flex: 1, paddingRight: 8 },
  rowLabel: { color: '#fff', fontSize: 15, fontWeight: '600' },
  rowHint: { color: 'rgba(255,255,255,0.35)', fontSize: 11, marginTop: 2 },
  iconBtn: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  saveBtn: {
    marginTop: 12,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
  },
  saveText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
});
