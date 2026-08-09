/**
 * Shared Stage renderer — used by visitors (UserProfile) and owner preview (My Profile / Edit Stage).
 * No free-form HTML/CSS; theme packs + modules only.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  ScrollView,
  Linking,
  Alert,
  useWindowDimensions,
} from 'react-native';
import { collection, query, where, getDocs, limit } from 'firebase/firestore';
import { firestore as db } from '../../config/firebase';
import { LinearGradient } from 'expo-linear-gradient';
import Icon from '../Icon';
import ProfileIdentityFlair from '../ProfileIdentityFlair';
import StandingBadge from '../StandingBadge';
import { STAGE_CONTENT_MAX } from '../../services/stageCatalog';
import { buildStageChecklist } from '../../services/stageService';

const COVER_H = 168;
const AVATAR = 92;

function openExternalUrl(url) {
  const u = String(url || '').trim();
  if (!u) return;
  Alert.alert('Leave Blyp?', `Open this link?\n\n${u}`, [
    { text: 'Cancel', style: 'cancel' },
    {
      text: 'Open',
      onPress: () => {
        Linking.openURL(u).catch(() => {
          Alert.alert('Could not open link');
        });
      },
    },
  ]);
}

function StageCover({ theme, wallpaper, coverUrl, liveStream, onLivePress }) {
  const fallback = theme?.colors?.coverFallback || ['#0A0A0C', '#00D2BE'];
  const wallColors = wallpaper?.colors;
  return (
    <View style={styles.coverWrap}>
      {coverUrl ? (
        <Image source={{ uri: coverUrl }} style={styles.coverImage} resizeMode="cover" />
      ) : (
        <LinearGradient
          colors={wallColors || fallback}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.coverImage}
        />
      )}
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.55)', theme?.colors?.bg || '#0A0A0C']}
        locations={[0.2, 0.65, 1]}
        style={styles.coverFade}
      />
      {liveStream ? (
        <TouchableOpacity
          style={styles.liveChip}
          onPress={() => onLivePress?.(liveStream)}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Watch live now"
        >
          <View style={styles.liveDot} />
          <Text style={styles.liveChipText}>Live now</Text>
          <Icon name="chevron-forward" size={14} color="#fff" />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function StageHeroIdentity({
  model,
  theme,
  isOwner,
  followerCount,
  followingCount,
  postCount,
  onFollowers,
  onFollowing,
}) {
  const handle = model?.username ? `@${model.username}` : '';
  const metaBits = [model?.pronouns, model?.location, model?.country].filter(Boolean);
  return (
    <View style={styles.heroIdentity}>
      <View style={styles.avatarRow}>
        <View style={[styles.avatarRing, { borderColor: theme.colors.accent }]}>
          {model?.photoURL ? (
            <Image source={{ uri: model.photoURL }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: theme.colors.surface }]}>
              <Icon name="person" size={36} color={theme.colors.textMuted} />
            </View>
          )}
        </View>
        <View style={styles.nameBlock}>
          <View style={styles.nameRow}>
            <Text style={[styles.displayName, { color: theme.colors.text }]} numberOfLines={1}>
              {model?.displayName || 'Stage'}
            </Text>
            {model?.verified ? (
              <View style={[styles.verifiedPill, { backgroundColor: theme.colors.accentSoft }]}>
                <Icon name="checkmark" size={12} color={theme.colors.accent} />
              </View>
            ) : null}
            <StandingBadge profile={model} variant="dot" />
          </View>
          <Text style={[styles.handle, { color: theme.colors.textMuted }]} numberOfLines={1}>
            {handle}
          </Text>
          {metaBits.length ? (
            <Text style={[styles.metaLine, { color: theme.colors.textMuted }]} numberOfLines={1}>
              {metaBits.join(' · ')}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={styles.statsRow}>
        <View style={styles.statItem}>
          <Text style={[styles.statNum, { color: theme.colors.text }]}>{postCount ?? 0}</Text>
          <Text style={[styles.statLabel, { color: theme.colors.textMuted }]}>Posts</Text>
        </View>
        <TouchableOpacity style={styles.statItem} onPress={onFollowers} activeOpacity={0.7}>
          <Text style={[styles.statNum, { color: theme.colors.text }]}>{followerCount ?? 0}</Text>
          <Text style={[styles.statLabel, { color: theme.colors.textMuted }]}>Followers</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.statItem} onPress={onFollowing} activeOpacity={0.7}>
          <Text style={[styles.statNum, { color: theme.colors.text }]}>{followingCount ?? 0}</Text>
          <Text style={[styles.statLabel, { color: theme.colors.textMuted }]}>Following</Text>
        </TouchableOpacity>
        {isOwner ? (
          <View style={[styles.stageBadge, { borderColor: theme.colors.border, backgroundColor: theme.colors.accentSoft }]}>
            <Text style={[styles.stageBadgeText, { color: theme.colors.accent }]}>Your Stage</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function StageAbout({ model, theme }) {
  const modules = model?.stage?.modules || {};
  if (modules.about === false) return null;
  const vibe = model?.stage?.vibe;
  const bio = model?.bio;
  if (!bio && !vibe) return null;
  return (
    <View style={[styles.section, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
      <Text style={[styles.sectionEyebrow, { color: theme.colors.accent }]}>About</Text>
      {vibe ? (
        <Text style={[styles.vibe, { color: theme.colors.accent }]} numberOfLines={2}>
          {vibe}
        </Text>
      ) : null}
      {bio ? (
        <Text style={[styles.bio, { color: theme.colors.text }]}>{bio}</Text>
      ) : null}
    </View>
  );
}

function StageLinks({ model, theme }) {
  const modules = model?.stage?.modules || {};
  if (modules.links === false) return null;
  const links = model?.stage?.links || [];
  const legacy = model?.website ? [{ id: 'legacy_website', label: 'Website', url: model.website }] : [];
  const all = links.length ? links : legacy;
  if (!all.length) return null;
  return (
    <View style={styles.sectionPlain}>
      <Text style={[styles.sectionEyebrow, { color: theme.colors.accent, marginBottom: 10 }]}>Links</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.linksRow}>
        {all.map((link) => (
          <TouchableOpacity
            key={link.id}
            style={[styles.linkChip, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}
            onPress={() => openExternalUrl(link.url)}
            activeOpacity={0.85}
          >
            <Icon name="link" size={14} color={theme.colors.accent} />
            <Text style={[styles.linkChipText, { color: theme.colors.text }]} numberOfLines={1}>
              {link.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

function StageTopCircle({ people, theme, onPersonPress, hidden }) {
  if (hidden) return null;
  if (!people?.length) return null;
  return (
    <View style={styles.sectionPlain}>
      <Text style={[styles.sectionEyebrow, { color: theme.colors.accent, marginBottom: 10 }]}>Top Circle</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.circleRow}>
        {people.map((p) => (
          <TouchableOpacity
            key={p.userId}
            style={styles.circleItem}
            onPress={() => onPersonPress?.(p)}
            activeOpacity={0.85}
          >
            {p.photoURL ? (
              <Image source={{ uri: p.photoURL }} style={[styles.circleAvatar, { borderColor: theme.colors.accent }]} />
            ) : (
              <View style={[styles.circleAvatar, styles.circleAvatarFallback, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}>
                <Icon name="person" size={18} color={theme.colors.textMuted} />
              </View>
            )}
            <Text style={[styles.circleName, { color: theme.colors.text }]} numberOfLines={1}>
              {p.displayName || p.username || '…'}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

function StageShowcase({ posts, theme, onPostPress, hidden }) {
  if (hidden) return null;
  if (!posts?.length) return null;
  return (
    <View style={styles.sectionPlain}>
      <Text style={[styles.sectionEyebrow, { color: theme.colors.accent, marginBottom: 10 }]}>Pinned</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pinsRow}>
        {posts.map((post) => {
          const thumb = post.thumbnail || post.thumbnailUrl || post.imageUrl || post.media?.[0]?.thumbnail || post.media?.[0]?.url;
          return (
            <TouchableOpacity
              key={post.id}
              style={[styles.pinCard, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}
              onPress={() => onPostPress?.(post)}
              activeOpacity={0.9}
            >
              {thumb ? (
                <Image source={{ uri: thumb }} style={styles.pinThumb} />
              ) : (
                <View style={[styles.pinThumb, styles.pinThumbFallback]}>
                  <Icon name="image" size={22} color={theme.colors.textMuted} />
                </View>
              )}
              {(post.type === 'video' || post.videoUrl) ? (
                <View style={styles.pinPlay}>
                  <Icon name="play" size={14} color="#fff" />
                </View>
              ) : null}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}


function pastLiveToMillis(value) {
  if (!value) return null;
  if (typeof value === 'number') return value;
  if (typeof value?.toMillis === 'function') {
    try { return value.toMillis(); } catch { return null; }
  }
  if (typeof value?.seconds === 'number') return value.seconds * 1000;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatPastLiveDate(ms) {
  if (!ms) return '';
  try {
    return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

/** Public strip when stage.showPastLives is opted in. Owner preview uses the same gate. */
function StagePastLives({ userId, enabled, theme }) {
  const [items, setItems] = useState([]);
  useEffect(() => {
    let cancelled = false;
    if (!enabled || !userId || !db) {
      setItems([]);
      return undefined;
    }
    (async () => {
      try {
        const q = query(collection(db, 'liveStreams'), where('userId', '==', userId), limit(50));
        const snap = await getDocs(q);
        const rows = (snap?.docs || [])
          .map((d) => {
            const data = d.data() || {};
            return {
              id: d.id,
              title: String(data.title || data.topic || 'Live').trim() || 'Live',
              thumbnailUrl: data.thumbnailUrl || data.thumbnail || data.coverUrl || null,
              status: String(data.status || '').toLowerCase(),
              endedAtMs: pastLiveToMillis(data.endedAt) ?? pastLiveToMillis(data.createdAt),
            };
          })
          .filter((r) => r.status !== 'live')
          .sort((a, b) => (b.endedAtMs || 0) - (a.endedAtMs || 0))
          .slice(0, 12);
        if (!cancelled) setItems(rows);
      } catch {
        if (!cancelled) setItems([]);
      }
    })();
    return () => { cancelled = true; };
  }, [enabled, userId]);

  if (!enabled) return null;
  if (!items.length) return null;

  return (
    <View style={styles.sectionPlain}>
      <Text style={[styles.sectionEyebrow, { color: theme.colors.accent, marginBottom: 10 }]}>Past lives</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pinsRow}>
        {items.map((item) => (
          <View
            key={item.id}
            style={[styles.pinCard, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}
          >
            {item.thumbnailUrl ? (
              <Image source={{ uri: item.thumbnailUrl }} style={styles.pinThumb} />
            ) : (
              <View style={[styles.pinThumb, styles.pinThumbFallback]}>
                <Icon name="videocam" size={22} color={theme.colors.textMuted} />
              </View>
            )}
            <View style={styles.pastLiveMeta}>
              <Text style={[styles.pastLiveTitle, { color: theme.colors.text }]} numberOfLines={2}>{item.title}</Text>
              {item.endedAtMs ? (
                <Text style={[styles.pastLiveDate, { color: theme.colors.textMuted }]}>{formatPastLiveDate(item.endedAtMs)}</Text>
              ) : null}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function OwnerChecklist({ model, theme, onEditStage }) {
  const items = useMemo(() => buildStageChecklist(model), [model]);
  const remaining = items.filter((i) => !i.done);
  if (!remaining.length) return null;
  return (
    <TouchableOpacity
      style={[styles.checklist, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}
      onPress={onEditStage}
      activeOpacity={0.88}
    >
      <Text style={[styles.checklistTitle, { color: theme.colors.text }]}>Build your Stage</Text>
      <Text style={[styles.checklistSub, { color: theme.colors.textMuted }]}>
        {remaining.length} step{remaining.length === 1 ? '' : 's'} left — tap to edit
      </Text>
      {remaining.slice(0, 3).map((item) => (
        <View key={item.id} style={styles.checklistRow}>
          <View style={[styles.checklistDot, { borderColor: theme.colors.accent }]} />
          <Text style={[styles.checklistItem, { color: theme.colors.textMuted }]}>{item.label}</Text>
        </View>
      ))}
    </TouchableOpacity>
  );
}

/**
 * Header-only Stage body ( fore FlatList ListHeaderComponent ).
 * Posts grid stays in the parent screen.
 */
export default function StageView({
  model,
  mode = 'visitor', // 'visitor' | 'owner' | 'preview'
  followerCount = 0,
  followingCount = 0,
  postCount = 0,
  liveStream = null,
  topCirclePeople = [],
  pinnedPosts = [],
  actions = null,
  onLivePress,
  onFollowers,
  onFollowing,
  onPersonPress,
  onPostPress,
  onEditStage,
  contentWidth,
}) {
  const { width: winW } = useWindowDimensions();
  const width = contentWidth || Math.min(winW, STAGE_CONTENT_MAX);
  const theme = model?.theme || { colors: {} };
  const modules = model?.stage?.modules || {};
  const isOwner = mode === 'owner' || mode === 'preview';

  if (!model) return null;

  return (
    <View style={[styles.root, { width, backgroundColor: theme.colors.bg || '#0A0A0C' }]}>
      <StageCover
        theme={theme}
        wallpaper={model.wallpaper}
        coverUrl={model.stage?.coverUrl}
        liveStream={liveStream}
        onLivePress={onLivePress}
      />
      <View style={styles.body}>
        <StageHeroIdentity
          model={model}
          theme={theme}
          isOwner={isOwner}
          followerCount={followerCount}
          followingCount={followingCount}
          postCount={postCount}
          onFollowers={onFollowers}
          onFollowing={onFollowing}
        />

        {actions}

        {mode === 'owner' ? (
          <OwnerChecklist model={model} theme={theme} onEditStage={onEditStage} />
        ) : null}

        <StageAbout model={model} theme={theme} />
        <StageLinks model={model} theme={theme} />
        <StageTopCircle
          people={topCirclePeople}
          theme={theme}
          onPersonPress={onPersonPress}
          hidden={modules.topCircle === false}
        />
        <StageShowcase
          posts={pinnedPosts}
          theme={theme}
          onPostPress={onPostPress}
          hidden={modules.showcase === false}
        />
        <StagePastLives
          userId={model.userId}
          enabled={model.stage?.showPastLives === true}
          theme={theme}
        />

        <ProfileIdentityFlair
          clubIds={model.profileClubs}
          badgeIds={model.profileBadges}
          style={styles.flair}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignSelf: 'center',
  },
  coverWrap: {
    height: COVER_H,
    width: '100%',
    overflow: 'hidden',
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
  },
  coverImage: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  coverFade: {
    ...StyleSheet.absoluteFillObject,
  },
  liveChip: {
    position: 'absolute',
    top: 14,
    right: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(220, 38, 38, 0.92)',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#fff',
  },
  liveChipText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
    letterSpacing: 0.2,
  },
  body: {
    paddingHorizontal: 18,
    marginTop: -AVATAR / 2 - 8,
  },
  heroIdentity: {
    marginBottom: 14,
  },
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 14,
  },
  avatarRing: {
    width: AVATAR + 6,
    height: AVATAR + 6,
    borderRadius: (AVATAR + 6) / 2,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0A0A0C',
  },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
  },
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameBlock: {
    flex: 1,
    paddingBottom: 6,
    minWidth: 0,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  displayName: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.3,
    flexShrink: 1,
  },
  verifiedPill: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handle: {
    marginTop: 2,
    fontSize: 14,
    fontWeight: '500',
  },
  metaLine: {
    marginTop: 3,
    fontSize: 12,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    gap: 18,
  },
  statItem: {
    alignItems: 'flex-start',
  },
  statNum: {
    fontSize: 17,
    fontWeight: '700',
  },
  statLabel: {
    fontSize: 12,
    marginTop: 1,
  },
  stageBadge: {
    marginLeft: 'auto',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  stageBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  section: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    marginBottom: 14,
  },
  sectionPlain: {
    marginBottom: 16,
  },
  sectionEyebrow: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  vibe: {
    fontSize: 15,
    fontWeight: '600',
    marginTop: 6,
    marginBottom: 4,
  },
  bio: {
    fontSize: 15,
    lineHeight: 22,
    marginTop: 4,
  },
  linksRow: {
    gap: 8,
    paddingRight: 8,
  },
  linkChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    maxWidth: 200,
  },
  linkChipText: {
    fontSize: 13,
    fontWeight: '600',
    flexShrink: 1,
  },
  circleRow: {
    gap: 14,
    paddingRight: 8,
  },
  circleItem: {
    width: 72,
    alignItems: 'center',
  },
  circleAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
  },
  circleAvatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleName: {
    marginTop: 6,
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
    width: '100%',
  },
  pinsRow: {
    gap: 10,
    paddingRight: 8,
  },
  pinCard: {
    width: 120,
    height: 160,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
  },
  pinThumb: {
    width: '100%',
    height: '100%',
  },
  pinThumbFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinPlay: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pastLiveMeta: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  pastLiveTitle: {
    fontSize: 11,
    fontWeight: '700',
  },
  pastLiveDate: {
    marginTop: 2,
    fontSize: 10,
    fontWeight: '600',
  },
  flair: {
    marginBottom: 8,
  },
  checklist: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    marginBottom: 14,
  },
  checklistTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  checklistSub: {
    fontSize: 13,
    marginTop: 3,
    marginBottom: 10,
  },
  checklistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  checklistDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1.5,
  },
  checklistItem: {
    fontSize: 13,
  },
});
