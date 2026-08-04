// TransparencyScreen.js
//
// The Blyp Transparency hub — "we show our working" made literal (see BLYP_CHARTER.md).
// In one place, anyone can read exactly how Blyp ranks, pays, charges and moderates,
// see precisely what data Blyp holds about them, check how their own posts are earning
// reach (their Blyp Score), and view their standing. Nothing here is hidden or spun.

import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import Icon from '../components/Icon';
import PostReachSheet from '../components/PostReachSheet';
import { COLORS } from '../styles/theme';
import { responsiveFont, responsiveSize } from '../utils/scaleUtils';
import { useAuth } from '../hooks/useCommon';
import { db, firebaseEnabled } from '../config/firebase';
import { snapData } from '../utils/firestoreSnap';
import {
  PLATFORM_RULES,
  PLANS,
  ECONOMICS,
  yourDataCategories,
  standingFor,
  getYourPosts,
} from '../services/transparencyService';

const STAGE_COLOR = {
  audition: '#f5a623',
  rising: '#00d2be',
  graduated: '#34c759',
  resting: '#8e8e93',
};

const BADGE_COLOR = {
  new: '#8e8e93',
  trusted: '#00d2be',
  verified: '#34c759',
  legacy: '#f5a623',
};

const Section = ({ title, subtitle, children }) => (
  <View style={styles.section}>
    <Text style={styles.sectionTitle}>{title}</Text>
    {!!subtitle && <Text style={styles.sectionSub}>{subtitle}</Text>}
    {children}
  </View>
);

// The "why we're different" story — stated as plain facts about how Blyp is
// built, never as an attack on anyone else (see BLYP_CHARTER.md).
const DIFFERENCE_POINTS = [
  { icon: 'trending-up-outline', title: 'Reach is earned, not bought', body: 'Good posts rise on merit. Paying gets you features and coins — it never buys you an audience.' },
  { icon: 'lock-closed-outline', title: 'You’re not the product', body: 'We don’t sell you by default. If a business ever wants access, we ask you in plain words and share what they pay.' },
  { icon: 'document-text-outline', title: 'No secret algorithm', body: 'How ranking, pay and moderation work is written down, in plain words, and it’s the same for everyone.' },
  { icon: 'phone-portrait-outline', title: 'Your world stays yours', body: 'Anything you bring in or connect stays on your device. Nothing is quietly siphoned off to us.' },
];

const TransparencyScreen = ({ navigation }) => {
  const { uid } = useAuth();
  const [profile, setProfile] = useState(null);
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        if (firebaseEnabled && db?.collection && uid) {
          const snap = await db.collection('users').doc(uid).get();
          const pd = snapData(snap);
          if (active && pd) setProfile({ id: uid, ...pd });
        }
        const yours = await getYourPosts(uid);
        if (active) setPosts(yours);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [uid]);

  const standing = useMemo(() => standingFor(profile || {}), [profile]);
  const dataCats = useMemo(() => yourDataCategories(), []);
  const badgeColor = BADGE_COLOR[standing.badgeTier] || COLORS.primary;

  return (
    <ScreenContainer>
      <View style={styles.topRow}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Icon name="chevron-back" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Transparency</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.intro}>
          We show our working. Here’s exactly how Blyp ranks, pays, charges and moderates — and everything Blyp holds about you.
        </Text>

        {/* Why Blyp is different */}
        <View style={styles.differentCard}>
          <Text style={styles.differentTitle}>Why Blyp is different</Text>
          <Text style={styles.differentLead}>
            Plenty of platforms keep their workings hidden and quietly sell your attention. We took the opposite path from day one.
          </Text>
          {DIFFERENCE_POINTS.map((d) => (
            <View key={d.title} style={styles.ruleRow}>
              <View style={styles.ruleIcon}>
                <Icon name={d.icon} size={18} color={COLORS.primary} />
              </View>
              <View style={styles.ruleText}>
                <Text style={styles.ruleTitle}>{d.title}</Text>
                <Text style={styles.ruleBody}>{d.body}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* Your standing */}
        <Section title="Your standing">
          <View style={styles.standingCard}>
            <View style={styles.standingRow}>
              <View style={[styles.badge, { borderColor: badgeColor, backgroundColor: `${badgeColor}22` }]}>
                <Icon name="ribbon-outline" size={15} color={badgeColor} />
                <Text style={[styles.badgeText, { color: badgeColor }]}>{standing.badgeLabel}</Text>
              </View>
              <Text style={styles.standingBadgeNote}>Public — shown on your avatar. Positive-only.</Text>
            </View>
            <View style={styles.standingDivider} />
            <View style={styles.standingRow}>
              <Text style={styles.ratingNum}>{standing.privateRating}</Text>
              <View style={styles.ratingMeta}>
                <Text style={styles.ratingLabel}>Account rating · private to you</Text>
                <Text style={styles.ratingNote}>
                  Behave well and it stays high. A complaint dips it while we look, then it bounces back if it was nothing.
                </Text>
              </View>
            </View>
          </View>
        </Section>

        {/* How Blyp works */}
        <Section title="How Blyp works" subtitle="The rules, the same for everyone.">
          {PLATFORM_RULES.map((r) => (
            <View key={r.title} style={styles.ruleRow}>
              <View style={styles.ruleIcon}>
                <Icon name={r.icon} size={18} color={COLORS.primary} />
              </View>
              <View style={styles.ruleText}>
                <Text style={styles.ruleTitle}>{r.title}</Text>
                <Text style={styles.ruleBody}>{r.body}</Text>
              </View>
            </View>
          ))}
          <TouchableOpacity
            style={styles.plansCta}
            activeOpacity={0.85}
            onPress={() => navigation.navigate('HowBlypWorks', { mode: 'review' })}
          >
            <Text style={styles.plansCtaText}>Read “How Blyp works” in full</Text>
            <Icon name="chevron-forward" size={16} color={COLORS.primary} />
          </TouchableOpacity>
        </Section>

        {/* Your posts' performance */}
        <Section title="Your posts" subtitle="Each post’s Blyp Score and how much reach it has earned. Tap for detail.">
          {loading ? (
            <ActivityIndicator color={COLORS.primary} style={{ marginVertical: 20 }} />
          ) : posts.length === 0 ? (
            <Text style={styles.emptyText}>No posts yet — once you post, your Blyp Scores show here.</Text>
          ) : (
            posts.map(({ post, reach }) => {
              const c = STAGE_COLOR[reach.stage] || COLORS.primary;
              const title = post.title || post.caption || post.description || 'Post';
              return (
                <TouchableOpacity
                  key={post.id}
                  style={styles.postRow}
                  activeOpacity={0.85}
                  onPress={() => setSelected(post)}
                >
                  <View style={[styles.scoreChip, { borderColor: c }]}>
                    <Text style={[styles.scoreChipNum, { color: c }]}>{reach.score == null ? '—' : reach.score}</Text>
                  </View>
                  <View style={styles.postText}>
                    <Text style={styles.postTitle} numberOfLines={1}>{title}</Text>
                    <Text style={styles.postMeta}>
                      {reach.label} · {reach.exposurePct}% reach · {reach.impressions} seen
                    </Text>
                  </View>
                  <Icon name="chevron-forward" size={18} color={COLORS.textMuted} />
                </TouchableOpacity>
              );
            })
          )}
        </Section>

        {/* Plans */}
        <Section title="Plans" subtitle="Paying buys features and coins — never reach.">
          {PLANS.map((p) => (
            <View key={p.id} style={[styles.planRow, p.highlight && styles.planRowHighlight]}>
              <View style={styles.planHeader}>
                <Text style={styles.planName}>{p.name}</Text>
                <Text style={[styles.planPrice, p.highlight && { color: COLORS.primary }]}>{p.price}</Text>
              </View>
              <Text style={styles.planBlurb}>{p.blurb}</Text>
            </View>
          ))}
          <TouchableOpacity style={styles.plansCta} activeOpacity={0.85} onPress={() => navigation.navigate('Plans')}>
            <Text style={styles.plansCtaText}>Manage your plan</Text>
            <Icon name="chevron-forward" size={16} color={COLORS.primary} />
          </TouchableOpacity>
        </Section>

        {/* Economics */}
        <Section title="The economics" subtitle="The numbers, published.">
          {ECONOMICS.map((e) => (
            <View key={e.label} style={styles.econRow}>
              <Text style={styles.econLabel}>{e.label}</Text>
              <Text style={styles.econValue}>{e.value}</Text>
            </View>
          ))}
        </Section>

        {/* Your data */}
        <Section title="Your data" subtitle="Exactly what Blyp holds, why, and for how long.">
          {dataCats.map((d) => (
            <View key={d.title} style={styles.ruleRow}>
              <View style={styles.ruleIcon}>
                <Icon name={d.icon} size={18} color={COLORS.primary} />
              </View>
              <View style={styles.ruleText}>
                <Text style={styles.ruleTitle}>{d.title}</Text>
                <Text style={styles.ruleBody}>{d.detail}</Text>
              </View>
            </View>
          ))}
          <Text style={styles.footNote}>
            We don’t sell you by default. If a business wants access to data, we ask you directly, in plain words, and a share of what they pay comes back to you — with zero penalty for saying no.
          </Text>
        </Section>
      </ScrollView>

      <PostReachSheet
        visible={!!selected}
        onClose={() => setSelected(null)}
        post={selected || {}}
        isOwner
        onEdited={() => {
          setSelected(null);
          getYourPosts(uid).then(setPosts);
        }}
      />
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingTop: responsiveSize(8), marginBottom: 6 },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { color: COLORS.textPrimary, fontSize: responsiveFont(18), fontWeight: '800' },
  scroll: { paddingHorizontal: 16, paddingBottom: 120 },
  intro: { color: COLORS.textSecondary, fontSize: responsiveFont(14), lineHeight: responsiveFont(20), marginVertical: 12 },

  differentCard: {
    backgroundColor: 'rgba(0,210,190,0.08)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(0,210,190,0.30)',
    padding: 16,
    marginBottom: 26,
  },
  differentTitle: { color: COLORS.textPrimary, fontSize: responsiveFont(17), fontWeight: '800', marginBottom: 6 },
  differentLead: { color: COLORS.textSecondary, fontSize: responsiveFont(13), lineHeight: responsiveFont(19), marginBottom: 16 },

  section: { marginBottom: 26 },
  sectionTitle: { color: COLORS.textPrimary, fontSize: responsiveFont(17), fontWeight: '800', marginBottom: 4 },
  sectionSub: { color: COLORS.textMuted, fontSize: responsiveFont(12), marginBottom: 12, lineHeight: responsiveFont(17) },

  standingCard: { backgroundColor: COLORS.backgroundCard, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: COLORS.border },
  standingRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1 },
  badgeText: { fontSize: responsiveFont(13), fontWeight: '800' },
  standingBadgeNote: { flex: 1, color: COLORS.textMuted, fontSize: responsiveFont(11), lineHeight: responsiveFont(15) },
  standingDivider: { height: StyleSheet.hairlineWidth, backgroundColor: COLORS.border, marginVertical: 14 },
  ratingNum: { color: COLORS.textPrimary, fontSize: responsiveFont(34), fontWeight: '900', minWidth: 56 },
  ratingMeta: { flex: 1 },
  ratingLabel: { color: COLORS.textPrimary, fontSize: responsiveFont(13), fontWeight: '700', marginBottom: 3 },
  ratingNote: { color: COLORS.textSecondary, fontSize: responsiveFont(12), lineHeight: responsiveFont(17) },

  ruleRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  ruleIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,210,190,0.12)', alignItems: 'center', justifyContent: 'center' },
  ruleText: { flex: 1 },
  ruleTitle: { color: COLORS.textPrimary, fontSize: responsiveFont(14), fontWeight: '700', marginBottom: 3 },
  ruleBody: { color: COLORS.textSecondary, fontSize: responsiveFont(13), lineHeight: responsiveFont(19) },

  postRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border },
  scoreChip: { width: 44, height: 44, borderRadius: 22, borderWidth: 2.5, alignItems: 'center', justifyContent: 'center' },
  scoreChipNum: { fontSize: responsiveFont(16), fontWeight: '900' },
  postText: { flex: 1 },
  postTitle: { color: COLORS.textPrimary, fontSize: responsiveFont(14), fontWeight: '700' },
  postMeta: { color: COLORS.textMuted, fontSize: responsiveFont(12), marginTop: 2 },
  emptyText: { color: COLORS.textMuted, fontSize: responsiveFont(13), paddingVertical: 12 },

  planRow: { backgroundColor: COLORS.backgroundCard, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: COLORS.border },
  planRowHighlight: { borderColor: COLORS.primary, borderWidth: 1.5 },
  planHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  planName: { color: COLORS.textPrimary, fontSize: responsiveFont(15), fontWeight: '800' },
  planPrice: { color: COLORS.textPrimary, fontSize: responsiveFont(14), fontWeight: '800' },
  planBlurb: { color: COLORS.textSecondary, fontSize: responsiveFont(12), lineHeight: responsiveFont(18) },
  plansCta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 12, marginTop: 2 },
  plansCtaText: { color: COLORS.primary, fontSize: responsiveFont(14), fontWeight: '800' },

  econRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border },
  econLabel: { flex: 1, color: COLORS.textSecondary, fontSize: responsiveFont(13) },
  econValue: { color: COLORS.textPrimary, fontSize: responsiveFont(13), fontWeight: '800', textAlign: 'right', maxWidth: '45%' },

  footNote: { color: COLORS.textMuted, fontSize: responsiveFont(12), lineHeight: responsiveFont(18), marginTop: 8 },
});

export default TransparencyScreen;
