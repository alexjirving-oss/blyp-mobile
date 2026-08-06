// PostReachSheet.js
//
// The creator-facing window into earn-your-reach. It shows a post's transparent Blyp
// Score, what stage it's in (audition / rising / established / resting), how wide its
// current audience wave is, and plain-English tips. For the owner it also offers an
// inline caption edit which sends the post back to a fresh, no-penalty audition.
//
// This is a deliberate anti-"black box": creators can always see exactly why a post
// is doing what it's doing. The same summary powers the Phase 6 Transparency hub.

import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Toast from 'react-native-toast-message';
import Icon from './Icon';
import { COLORS } from '../styles/theme';
import { responsiveFont, responsiveSize } from '../utils/scaleUtils';
import { reachSummary } from '../services/blypReachClient';
import { updatePostContent } from '../services/postEditService';

const STAGE_COLOR = {
  audition: '#f5a623',
  rising: '#00d2be',
  graduated: '#34c759',
  resting: '#8e8e93',
};

const PostReachSheet = ({ visible, onClose, post, isOwner = false, onEdited, navigation }) => {
  const summary = useMemo(() => reachSummary(post || {}), [post]);
  const [editing, setEditing] = useState(false);
  const [caption, setCaption] = useState('');
  const [saving, setSaving] = useState(false);

  const startEdit = () => {
    setCaption(String(post?.caption || post?.description || post?.title || ''));
    setEditing(true);
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const res = await updatePostContent(post.id, post, { caption });
      if (res?.ok) {
        Toast.show({
          type: 'success',
          text1: 'Post updated',
          text2: 'It’s back in audition to re-earn its reach — no penalty.',
          position: 'bottom',
          visibilityTime: 2500,
        });
        setEditing(false);
        onEdited?.(res.reach);
        onClose?.();
      } else {
        Toast.show({ type: 'error', text1: 'Couldn’t update', text2: 'Please try again.', position: 'bottom' });
      }
    } finally {
      setSaving(false);
    }
  };

  const color = STAGE_COLOR[summary.stage] || COLORS.primary;
  const waveDots = [];
  if (summary.has) {
    for (let i = 0; i <= (summary.maxWave || 4); i += 1) {
      waveDots.push(i <= (summary.wave || 0));
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.backdropTap} activeOpacity={1} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.headerRow}>
            <Text style={styles.title}>Your reach</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Icon name="close" size={22} color={COLORS.textPrimary} />
            </TouchableOpacity>
          </View>

          {Boolean(post?.reach?.boosted || post?.promoteType === 'FEED_BOOST' || post?.promoteBoostWeight > 0) && (
            <View style={styles.boostBanner}>
              <Icon name="flash" size={16} color={COLORS.primary} />
              <Text style={styles.boostBannerText}>Feed Boost is amplifying this post</Text>
            </View>
          )}

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
            {/* Score + stage */}
            <View style={styles.scoreRow}>
              <View style={[styles.scoreRing, { borderColor: color }]}>
                <Text style={[styles.scoreNum, { color }]}>{summary.score == null ? '—' : summary.score}</Text>
                <Text style={styles.scoreOf}>Blyp Score</Text>
              </View>
              <View style={styles.scoreMeta}>
                <View style={[styles.stagePill, { backgroundColor: `${color}22`, borderColor: color }]}>
                  <Text style={[styles.stageText, { color }]}>{summary.label}</Text>
                </View>
                <Text style={styles.headline}>{summary.headline}</Text>
              </View>
            </View>

            {/* Wave progress */}
            {summary.has && (
              <View style={styles.waveWrap}>
                <View style={styles.waveDots}>
                  {waveDots.map((on, i) => (
                    <View
                      key={i}
                      style={[styles.waveDot, { backgroundColor: on ? color : COLORS.border }]}
                    />
                  ))}
                </View>
                <Text style={styles.waveLabel}>
                  Reaching about {summary.exposurePct}% of your eligible audience · {summary.impressions} impressions
                </Text>
              </View>
            )}

            <Text style={styles.detail}>{summary.detail}</Text>

            {summary.tips?.length > 0 && (
              <View style={styles.tips}>
                <Text style={styles.tipsTitle}>How reach is earned</Text>
                {summary.tips.map((t) => (
                  <View key={t} style={styles.tipRow}>
                    <Icon name="checkmark-circle" size={15} color={COLORS.primary} />
                    <Text style={styles.tipText}>{t}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* Owner edit / re-audition */}
            
            {isOwner && (
              <TouchableOpacity
                style={styles.boostCta}
                activeOpacity={0.85}
                onPress={() => {
                  onClose?.();
                  navigation?.navigate?.('Profile', {
                    openPromote: true,
                    promoteMethodId: 'feed_boost',
                  });
                }}
              >
                <Icon name="rocket-outline" size={17} color={COLORS.black} />
                <Text style={styles.boostCtaText}>Boost this post</Text>
              </TouchableOpacity>
            )}

{isOwner && !editing && (
              <TouchableOpacity style={styles.editBtn} activeOpacity={0.85} onPress={startEdit}>
                <Icon name="create-outline" size={17} color={COLORS.black} />
                <Text style={styles.editBtnText}>Edit & re-audition</Text>
              </TouchableOpacity>
            )}

            {isOwner && editing && (
              <View style={styles.editWrap}>
                <Text style={styles.editLabel}>Caption</Text>
                <TextInput
                  style={styles.editInput}
                  value={caption}
                  onChangeText={setCaption}
                  placeholder="Write a new caption…"
                  placeholderTextColor={COLORS.textMuted}
                  multiline
                />
                <Text style={styles.editNote}>
                  Editing sends this post back to a fresh audition. It re-earns reach on the new content — no penalty for improving it.
                </Text>
                <View style={styles.editActions}>
                  <TouchableOpacity style={styles.cancelBtn} activeOpacity={0.85} onPress={() => setEditing(false)} disabled={saving}>
                    <Text style={styles.cancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.saveBtn} activeOpacity={0.85} onPress={save} disabled={saving}>
                    {saving ? (
                      <ActivityIndicator size="small" color={COLORS.black} />
                    ) : (
                      <Text style={styles.saveText}>Save & re-audition</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  backdropTap: { flex: 1 },
  sheet: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 18,
    paddingBottom: responsiveSize(28),
    maxHeight: '86%',
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: COLORS.border, marginTop: 10, marginBottom: 8 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  title: { color: COLORS.textPrimary, fontSize: responsiveFont(18), fontWeight: '800' },
  body: { paddingBottom: 12 },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 18 },
  scoreRing: {
    width: 92,
    height: 92,
    borderRadius: 46,
    borderWidth: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreNum: { fontSize: responsiveFont(30), fontWeight: '900' },
  scoreOf: { color: COLORS.textMuted, fontSize: responsiveFont(9), fontWeight: '700', letterSpacing: 0.5, marginTop: 1 },
  scoreMeta: { flex: 1, gap: 8 },
  stagePill: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1 },
  stageText: { fontSize: responsiveFont(12), fontWeight: '800' },
  headline: { color: COLORS.textPrimary, fontSize: responsiveFont(15), fontWeight: '700', lineHeight: responsiveFont(20) },
  waveWrap: { marginBottom: 16 },
  waveDots: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  waveDot: { flex: 1, height: 6, borderRadius: 3 },
  waveLabel: { color: COLORS.textSecondary, fontSize: responsiveFont(12) },
  detail: { color: COLORS.textSecondary, fontSize: responsiveFont(14), lineHeight: responsiveFont(21), marginBottom: 16 },
  tips: { backgroundColor: COLORS.backgroundCard, borderRadius: 14, padding: 14, marginBottom: 18, borderWidth: 1, borderColor: COLORS.border },
  tipsTitle: { color: COLORS.textMuted, fontSize: responsiveFont(11), fontWeight: '800', letterSpacing: 1, marginBottom: 10 },
  tipRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 8 },
  tipText: { flex: 1, color: COLORS.textSecondary, fontSize: responsiveFont(13), lineHeight: responsiveFont(18) },
  boostBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.backgroundCard,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: COLORS.primary,
    marginBottom: 10,
  },
  boostBannerText: { color: COLORS.textPrimary, fontSize: responsiveFont(12), fontWeight: '700', flex: 1 },
  boostCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    paddingVertical: 12,
    marginBottom: 12,
  },
  boostCtaText: { color: COLORS.black, fontWeight: '800', fontSize: responsiveFont(14) },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: COLORS.primary,
  },
  editBtnText: { color: COLORS.black, fontSize: responsiveFont(15), fontWeight: '800' },
  editWrap: { marginTop: 4 },
  editLabel: { color: COLORS.textMuted, fontSize: responsiveFont(11), fontWeight: '800', letterSpacing: 1, marginBottom: 8 },
  editInput: {
    minHeight: 90,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    color: COLORS.textPrimary,
    fontSize: responsiveFont(15),
    padding: 12,
    textAlignVertical: 'top',
  },
  editNote: { color: COLORS.textMuted, fontSize: responsiveFont(12), lineHeight: responsiveFont(17), marginTop: 10 },
  editActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  cancelBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 13, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border },
  cancelText: { color: COLORS.textSecondary, fontSize: responsiveFont(14), fontWeight: '700' },
  saveBtn: { flex: 2, alignItems: 'center', justifyContent: 'center', paddingVertical: 13, borderRadius: 12, backgroundColor: COLORS.primary },
  saveText: { color: COLORS.black, fontSize: responsiveFont(14), fontWeight: '800' },
});

export default PostReachSheet;
