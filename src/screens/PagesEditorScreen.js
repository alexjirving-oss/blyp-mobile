// PagesEditorScreen.js
//
// Lets the user own their Home: reorder pages, show/hide optional pages, and
// retune their interests. Everything persists via userPreferencesService and
// HomeScreen updates live through its subscription.

import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import Icon from '../components/Icon';
import { COLORS } from '../styles/theme';
import { responsiveFont, responsiveSize } from '../utils/scaleUtils';
import { useAuth } from '../hooks/useCommon';
import {
  INTEREST_CATALOG,
  getPreferences,
  setPages as savePages,
  setInterests as saveInterests,
  addPage as addPagePref,
  removePage as removePagePref,
  topicPageForInterest,
  isTopicPageKey,
} from '../services/userPreferencesService';

const PagesEditorScreen = ({ navigation }) => {
  const { uid } = useAuth();
  const [pages, setPagesState] = useState([]);
  const [interests, setInterestsState] = useState([]);
  const saveQueueRef = useRef(Promise.resolve());
  const pageSaveRevisionRef = useRef(0);
  const interestSaveRevisionRef = useRef(0);

  useEffect(() => {
    let active = true;
    saveQueueRef.current = Promise.resolve();
    getPreferences(uid).then((p) => {
      if (!active) return;
      setPagesState(p.pages);
      setInterestsState(p.interests);
    });
    return () => {
      active = false;
    };
  }, [uid]);

  const enqueuePreferenceSave = (write) => {
    const task = saveQueueRef.current.then(write, write);
    saveQueueRef.current = task.catch(() => {});
    return task;
  };

  const persistPages = (next) => {
    setPagesState(next);
    const revision = ++pageSaveRevisionRef.current;
    enqueuePreferenceSave(() => savePages(uid, next))
      .then((saved) => {
        if (revision === pageSaveRevisionRef.current && saved?.pages) {
          setPagesState(saved.pages);
        }
      })
      .catch(() => {});
  };

  const move = (index, dir) => {
    const next = [...pages];
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    persistPages(next);
  };

  const togglePage = (index) => {
    const next = pages.map((p, i) =>
      i === index && !p.fixed ? { ...p, enabled: p.enabled === false } : p
    );
    persistPages(next);
  };

  const toggleInterest = (id) => {
    const next = interests.includes(id)
      ? interests.filter((x) => x !== id)
      : [...interests, id];
    setInterestsState(next);
    const revision = ++interestSaveRevisionRef.current;
    enqueuePreferenceSave(() => saveInterests(uid, next))
      .then((saved) => {
        if (revision === interestSaveRevisionRef.current && saved?.interests) {
          setInterestsState(saved.interests);
          if (saved.pages) setPagesState(saved.pages);
        }
      })
      .catch(() => {});
  };

  const addTopic = async (interest) => {
    const page = topicPageForInterest(interest);
    const saved = await enqueuePreferenceSave(() => addPagePref(uid, page));
    if (saved?.pages) setPagesState(saved.pages);
  };

  const removeTopic = async (key) => {
    const saved = await enqueuePreferenceSave(() => removePagePref(uid, key));
    if (saved?.pages) setPagesState(saved.pages);
  };

  const addablePages = INTEREST_CATALOG.filter(
    (i) => !pages.some((p) => p.key === `topic:${i.id}`)
  );
  const landingIndex = pages.findIndex((page) => page.enabled !== false);

  return (
    <ScreenContainer>
      <View style={styles.container}>
        <View style={styles.topRow}>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Icon name="chevron-back" size={24} color={COLORS.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.title}>Customize Home</Text>
          <View style={styles.backBtn} />
        </View>

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <Text style={styles.sectionTitle}>Your pages</Text>
          <Text style={styles.sectionSub}>
            Reorder them, or hide the ones you don't use. The first shown page opens by default and
            when you double-tap the bottom Home button.
          </Text>

          <View style={styles.list}>
            {pages.map((p, i) => {
              const enabled = p.enabled !== false;
              return (
                <View key={p.key} style={[styles.pageRow, i === landingIndex && styles.pageRowFirst]}>
                  <View style={styles.reorder}>
                    <TouchableOpacity onPress={() => move(i, -1)} disabled={i === 0} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                      <Icon name="chevron-up" size={20} color={i === 0 ? COLORS.textDisabled : COLORS.textSecondary} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => move(i, 1)} disabled={i === pages.length - 1} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                      <Icon name="chevron-down" size={20} color={i === pages.length - 1 ? COLORS.textDisabled : COLORS.textSecondary} />
                    </TouchableOpacity>
                  </View>

                  <View style={styles.pageInfo}>
                    <Text style={[styles.pageLabel, !enabled && styles.pageLabelOff]}>{p.label}</Text>
                    {i === landingIndex && <Text style={styles.homeTag}>Landing page</Text>}
                    {p.fixed && <Text style={styles.fixedTag}>Always on</Text>}
                    {isTopicPageKey(p.key) && <Text style={styles.topicTag}>Topic</Text>}
                  </View>

                  <TouchableOpacity
                    style={[styles.toggle, enabled && styles.toggleOn, p.fixed && styles.toggleLocked]}
                    onPress={() => togglePage(i)}
                    disabled={p.fixed}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.toggleText, enabled && styles.toggleTextOn]}>
                      {enabled ? 'Shown' : 'Hidden'}
                    </Text>
                  </TouchableOpacity>

                  {p.removable && (
                    <TouchableOpacity
                      style={styles.removeBtn}
                      onPress={() => removeTopic(p.key)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Icon name="trash-outline" size={18} color={COLORS.textMuted} />
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
          </View>

          {addablePages.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>Add a topic page</Text>
              <Text style={styles.sectionSub}>Add a dedicated feed for any topic. It becomes its own page on Home.</Text>
              <View style={styles.addGrid}>
                {addablePages.map((i) => (
                  <TouchableOpacity key={i.id} style={styles.addChip} activeOpacity={0.85} onPress={() => addTopic(i)}>
                    <Icon name={i.icon} size={16} color={COLORS.primary} />
                    <Text style={styles.addChipText}>{i.label}</Text>
                    <Icon name="add" size={16} color={COLORS.primary} />
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          <Text style={styles.sectionTitle}>Your interests</Text>
          <Text style={styles.sectionSub}>These tune your home suggestions and what Blyp recommends.</Text>
          <View style={styles.interestGrid}>
            {INTEREST_CATALOG.map((item) => {
              const on = interests.includes(item.id);
              return (
                <TouchableOpacity
                  key={item.id}
                  style={[styles.interestChip, on && styles.interestChipOn]}
                  activeOpacity={0.85}
                  onPress={() => toggleInterest(item.id)}
                >
                  <Icon name={item.icon} size={16} color={on ? COLORS.black : COLORS.textPrimary} />
                  <Text style={[styles.interestText, on && styles.interestTextOn]}>{item.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={{ height: responsiveSize(40) }} />
        </ScrollView>
      </View>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: responsiveSize(8) },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, marginBottom: 8 },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { color: COLORS.textPrimary, fontSize: responsiveFont(18), fontWeight: '800' },
  scroll: { paddingHorizontal: 16, paddingTop: 8 },

  sectionTitle: { color: COLORS.textPrimary, fontSize: responsiveFont(17), fontWeight: '800', marginTop: 18 },
  sectionSub: { color: COLORS.textSecondary, fontSize: responsiveFont(13), marginTop: 4, marginBottom: 14, lineHeight: responsiveFont(19) },

  list: { gap: 10 },
  pageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: COLORS.backgroundCard,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  pageRowFirst: { borderColor: COLORS.primary },
  reorder: { alignItems: 'center', justifyContent: 'center' },
  pageInfo: { flex: 1 },
  pageLabel: { color: COLORS.textPrimary, fontSize: responsiveFont(15), fontWeight: '700' },
  pageLabelOff: { color: COLORS.textMuted },
  homeTag: { color: COLORS.primary, fontSize: responsiveFont(11), fontWeight: '700', marginTop: 2 },
  fixedTag: { color: COLORS.textMuted, fontSize: responsiveFont(11), marginTop: 2 },
  topicTag: { color: COLORS.textMuted, fontSize: responsiveFont(11), marginTop: 2 },
  removeBtn: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', marginLeft: 2 },
  addGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginBottom: 4 },
  addChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 45, 85,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 45, 85,0.3)',
  },
  addChipText: { color: COLORS.textPrimary, fontSize: responsiveFont(13), fontWeight: '600' },
  toggle: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  toggleOn: { backgroundColor: 'rgba(255, 45, 85,0.14)', borderColor: COLORS.primary },
  toggleLocked: { opacity: 0.5 },
  toggleText: { color: COLORS.textMuted, fontSize: responsiveFont(12), fontWeight: '700' },
  toggleTextOn: { color: COLORS.primary },

  interestGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  interestChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: COLORS.backgroundCard,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  interestChipOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  interestText: { color: COLORS.textPrimary, fontSize: responsiveFont(13), fontWeight: '600' },
  interestTextOn: { color: COLORS.black, fontWeight: '800' },
});

export default PagesEditorScreen;
