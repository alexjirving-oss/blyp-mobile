// ImportContentScreen.js
//
// "Bring your content over" — a signed-in user types their TikTok username,
// confirms it's theirs, and we import their videos onto their Blyp profile.
//
// This screen only *requests* the import (writes a pending doc via
// socialImportService). A backend worker fulfils it and streams progress back,
// which we render live here. See tools/import/blyp_import_worker.js.
// Staggered publish: upload all media now, go live over time (queue below).

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../styles/theme';
import { responsiveFont, responsiveSize } from '../utils/scaleUtils';
import { useAuth } from '../hooks/useCommon';
import {
  IMPORT_PLATFORMS,
  IMPORT_STATUS,
  cancelImport,
  isImportActive,
  isValidHandleFor,
  normalizeHandleFor,
  requestImport,
  subscribeImports,
} from '../services/socialImportService';
import {
  bulkUpdateScheduled,
  cancelScheduledPost,
  formatPublishAt,
  publishScheduledNow,
  subscribeScheduledPosts,
} from '../services/scheduledPublishService';
import { STAGGER_DEFAULTS } from '../utils/publishSchedule';

const STALL_MS = 3 * 60 * 1000;

const PACE_OPTIONS = [
  { postsPerDay: 1, label: '1/day' },
  { postsPerDay: 2, label: '2/day' },
  { postsPerDay: 3, label: '3/day' },
  { postsPerDay: 5, label: '5/day' },
  { postsPerDay: 8, label: '8/day' },
  { postsPerDay: 12, label: '12/day' },
];

const ImportContentScreen = ({ navigation }) => {
  const { uid } = useAuth();

  const [platform, setPlatform] = useState('tiktok');
  const [handle, setHandle] = useState('');
  const [owns, setOwns] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [imports, setImports] = useState([]);
  const [now, setNow] = useState(Date.now());
  const [canceling, setCanceling] = useState(false);
  const [staggerEnabled, setStaggerEnabled] = useState(true);
  const [postsPerDay, setPostsPerDay] = useState(STAGGER_DEFAULTS.postsPerDay);
  const [startMode, setStartMode] = useState('now');
  const [scheduledPosts, setScheduledPosts] = useState([]);
  const [queueBusy, setQueueBusy] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 20000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!uid) return undefined;
    const unsub = subscribeImports(uid, setImports);
    return () => { try { unsub && unsub(); } catch { /* ignore */ } };
  }, [uid]);

  useEffect(() => {
    if (!uid) return undefined;
    const unsub = subscribeScheduledPosts(uid, setScheduledPosts);
    return () => { try { unsub && unsub(); } catch { /* ignore */ } };
  }, [uid]);

  const request = imports[0] || null;
  const active = useMemo(() => imports.some((r) => isImportActive(r)), [imports]);
  const stalledReq = useMemo(
    () => imports.find((r) => isImportActive(r) && now - (r.updatedAt || r.createdAt || 0) > STALL_MS) || null,
    [imports, now],
  );
  const hasHistory = imports.length > 0;
  const platformLabel = IMPORT_PLATFORMS.find((p) => p.id === platform)?.label || 'TikTok';
  const normalized = useMemo(() => normalizeHandleFor(platform, handle), [platform, handle]);
  const canSubmit = !busy && !active && owns && isValidHandleFor(platform, normalized);

  const onSubmit = useCallback(async () => {
    Keyboard.dismiss();
    setError('');
    if (!owns) {
      setError('Please confirm these are your own videos first.');
      return;
    }
    if (!isValidHandleFor(platform, normalized)) {
      setError(`That doesnÔÇÖt look like a valid ${platformLabel} username.`);
      return;
    }
    setBusy(true);
    try {
      const startAt = startMode === 'tomorrow'
        ? (() => {
          const d = new Date();
          d.setDate(d.getDate() + 1);
          d.setHours(9, 0, 0, 0);
          return d.getTime();
        })()
        : Date.now();
      await requestImport({
        uid,
        platform,
        handle: normalized,
        claimedOwnership: owns,
        stagger: {
          enabled: staggerEnabled,
          postsPerDay: staggerEnabled ? postsPerDay : undefined,
          startAt,
          jitterMs: staggerEnabled ? STAGGER_DEFAULTS.jitterMs : 0,
        },
      });
      setHandle('');
      setOwns(false);
    } catch (e) {
      setError(e?.message || 'CouldnÔÇÖt start the import. Please try again.');
    } finally {
      setBusy(false);
    }
  }, [uid, platform, platformLabel, normalized, owns, staggerEnabled, postsPerDay, startMode]);

  const onCancel = useCallback(async () => {
    const targets = imports.filter((r) => isImportActive(r));
    if (targets.length === 0) return;
    setCanceling(true);
    setError('');
    try {
      const results = await Promise.allSettled(targets.map((r) => cancelImport(r.id)));
      if (results.some((x) => x.status === 'rejected')) {
        setError('CouldnÔÇÖt cancel everything. Please try again.');
      }
    } catch (e) {
      setError(e?.message || 'CouldnÔÇÖt cancel. Please try again.');
    } finally {
      setCanceling(false);
    }
  }, [imports]);

  const onQueueAction = useCallback(async (action) => {
    if (!uid || queueBusy) return;
    setQueueBusy(true);
    setError('');
    try {
      await bulkUpdateScheduled({
        uid,
        action,
        stagger: { enabled: true, postsPerDay, startAt: Date.now() },
      });
    } catch (e) {
      setError(e?.message || 'CouldnÔÇÖt update the publish queue.');
    } finally {
      setQueueBusy(false);
    }
  }, [uid, queueBusy, postsPerDay]);

  return (
    <ScreenContainer>
      <View style={styles.topRow}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation?.goBack?.()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="chevron-back" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Bring your content</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <Ionicons name="cloud-download-outline" size={26} color={COLORS.primary} />
          <Text style={styles.heroText}>
            {hasHistory
              ? 'Got videos on more than one account? Add another and weÔÇÖll bring those over too.'
              : 'Already make videos elsewhere? Pull them in so your Blyp profile feels like home from day one.'}
          </Text>
        </View>

        <Text style={styles.sectionLabel}>{hasHistory ? 'Add another account' : 'Choose a platform'}</Text>
        <View style={styles.platformRow}>
          {IMPORT_PLATFORMS.map((p) => {
            const selected = p.id === platform;
            return (
              <TouchableOpacity
                key={p.id}
                activeOpacity={0.85}
                disabled={!p.enabled}
                onPress={() => p.enabled && setPlatform(p.id)}
                style={[
                  styles.platformChip,
                  selected && styles.platformChipSelected,
                  !p.enabled && styles.platformChipDisabled,
                ]}
              >
                <Ionicons name={p.icon} size={20} color={selected ? '#001b18' : COLORS.textSecondary} />
                <Text style={[styles.platformText, selected && styles.platformTextSelected]}>{p.label}</Text>
                {!p.enabled && <Text style={styles.soonTag}>soon</Text>}
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.sectionLabel}>Your {platformLabel} {platform === 'youtube' ? 'channel' : 'username'}</Text>
        <View style={styles.inputRow}>
          <Text style={styles.at}>@</Text>
          <TextInput
            style={styles.input}
            value={handle}
            onChangeText={(t) => { setHandle(t); if (error) setError(''); }}
            placeholder={platform === 'youtube' ? '@yourchannel or channel URL' : 'yourusername'}
            placeholderTextColor={COLORS.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!active}
            returnKeyType="done"
            onSubmitEditing={canSubmit ? onSubmit : undefined}
          />
        </View>

        <TouchableOpacity
          style={styles.ownRow}
          activeOpacity={0.8}
          disabled={active}
          onPress={() => setOwns((v) => !v)}
        >
          <View style={[styles.checkbox, owns && styles.checkboxOn]}>
            {owns && <Ionicons name="checkmark" size={15} color="#001b18" />}
          </View>
          <Text style={styles.ownText}>
            These are my own videos and I have the right to post them on Blyp.
          </Text>
        </TouchableOpacity>

        <Text style={styles.sectionLabel}>Publish pace</Text>
        <TouchableOpacity
          style={styles.ownRow}
          activeOpacity={0.8}
          disabled={active}
          onPress={() => setStaggerEnabled((v) => !v)}
        >
          <View style={[styles.checkbox, staggerEnabled && styles.checkboxOn]}>
            {staggerEnabled && <Ionicons name="checkmark" size={15} color="#001b18" />}
          </View>
          <Text style={styles.ownText}>
            Space posts out over time (recommended). We upload everything now, then go live in stages — not all at once.
          </Text>
        </TouchableOpacity>

        {staggerEnabled && (
          <>
            <View style={styles.platformRow}>
              {PACE_OPTIONS.map((o) => {
                const selected = postsPerDay === o.postsPerDay;
                return (
                  <TouchableOpacity
                    key={o.postsPerDay}
                    activeOpacity={0.85}
                    disabled={active}
                    onPress={() => setPostsPerDay(o.postsPerDay)}
                    style={[styles.platformChip, selected && styles.platformChipSelected]}
                  >
                    <Text style={[styles.platformText, selected && styles.platformTextSelected]}>{o.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={styles.platformRow}>
              <TouchableOpacity
                activeOpacity={0.85}
                disabled={active}
                onPress={() => setStartMode('now')}
                style={[styles.platformChip, startMode === 'now' && styles.platformChipSelected]}
              >
                <Text style={[styles.platformText, startMode === 'now' && styles.platformTextSelected]}>Start now</Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.85}
                disabled={active}
                onPress={() => setStartMode('tomorrow')}
                style={[styles.platformChip, startMode === 'tomorrow' && styles.platformChipSelected]}
              >
                <Text style={[styles.platformText, startMode === 'tomorrow' && styles.platformTextSelected]}>Start tomorrow 9am</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {!!error && <Text style={styles.errorText}>{error}</Text>}

        <TouchableOpacity
          style={[styles.cta, canSubmit ? styles.ctaPrimary : styles.ctaDisabled]}
          activeOpacity={0.9}
          disabled={!canSubmit}
          onPress={onSubmit}
        >
          {busy
            ? <ActivityIndicator color="#001b18" />
            : <Text style={styles.ctaText}>{active ? 'Import in progress…' : hasHistory ? 'Import this account too' : 'Import my videos'}</Text>}
        </TouchableOpacity>

        {active && !stalledReq && (
          <Text style={styles.helperNote}>
            One import runs at a time. As soon as this one finishes you can add another account.
          </Text>
        )}

        <View style={styles.howItWorksCard}>
          <View style={styles.howRow}>
            <Ionicons name="cloud-done-outline" size={18} color={COLORS.primary} />
            <Text style={styles.howText}>
              Importing happens on our servers — you can close the app or lose signal and it keeps
              going. Come back any time to see how itÔÇÖs getting on.
            </Text>
          </View>
          <View style={styles.howRow}>
            <Ionicons name="timer-outline" size={18} color={COLORS.primary} />
            <Text style={styles.howText}>
              With paced publish, clips stay as drafts until their scheduled time. Pause, cancel, or
              publish early from the queue below.
            </Text>
          </View>
          <View style={styles.howRow}>
            <Ionicons name="copy-outline" size={18} color={COLORS.primary} />
            <Text style={styles.howText}>
              We never import the same video twice. If an import stops early, just start it again for
              the same account — weÔÇÖll skip everything thatÔÇÖs already here and only bring over whatÔÇÖs new.
            </Text>
          </View>
        </View>

        {!!stalledReq && (
          <View style={styles.stallCard}>
            <View style={styles.progressHead}>
              <Ionicons name="warning" size={18} color="#FBBF24" />
              <Text style={[styles.progressTitle, { color: '#FBBF24' }]}>This import is taking too long</Text>
            </View>
            <Text style={styles.progressMsg}>
              We couldnÔÇÖt make progress on @{stalledReq.handle}. This usually means the import service is
              temporarily offline. You can cancel and try again later.
            </Text>
            <TouchableOpacity
              style={[styles.cancelBtn]}
              activeOpacity={0.9}
              disabled={canceling}
              onPress={onCancel}
            >
              {canceling ? <ActivityIndicator color="#ff6b6b" /> : <Text style={styles.cancelText}>Cancel this import</Text>}
            </TouchableOpacity>
          </View>
        )}

        {!!request && <ImportProgress request={request} />}

        {scheduledPosts.length > 0 && (
          <ScheduleQueue
            posts={scheduledPosts}
            busy={queueBusy}
            onPauseAll={() => onQueueAction('pause')}
            onResumeAll={() => onQueueAction('resume')}
            onCancelAll={() => onQueueAction('cancel')}
            onPublishOne={async (id) => {
              setQueueBusy(true);
              try { await publishScheduledNow(id); } catch (e) { setError(e?.message || 'Publish failed'); }
              finally { setQueueBusy(false); }
            }}
            onCancelOne={async (id) => {
              setQueueBusy(true);
              try { await cancelScheduledPost(id); } catch (e) { setError(e?.message || 'Cancel failed'); }
              finally { setQueueBusy(false); }
            }}
          />
        )}

        {imports.length > 1 && <ImportHistory imports={imports.slice(1)} />}

        <Text style={styles.footNote}>
          We bring over your public videos with their captions, hashtags and original dates, so they slot into your
          profile naturally. You can delete any of them afterwards, any time.
        </Text>
      </ScrollView>
    </ScreenContainer>
  );
};

const ScheduleQueue = ({
  posts,
  busy,
  onPauseAll,
  onResumeAll,
  onCancelAll,
  onPublishOne,
  onCancelOne,
}) => {
  const paused = posts.filter((p) => p.publishStatus === 'paused').length;
  const upcoming = posts.filter((p) => p.publishStatus === 'scheduled').length;
  return (
    <View style={styles.historyWrap}>
      <Text style={styles.sectionLabel}>Publish queue ┬À {posts.length}</Text>
      <Text style={styles.progressMeta}>
        {upcoming} scheduled{paused ? ` ┬À ${paused} paused` : ''}
      </Text>
      <View style={[styles.platformRow, { marginTop: 10 }]}>
        <TouchableOpacity style={styles.queueBtn} disabled={busy} onPress={onPauseAll}>
          <Text style={styles.queueBtnText}>Pause all</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.queueBtn} disabled={busy} onPress={onResumeAll}>
          <Text style={styles.queueBtnText}>Resume</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.queueBtn, styles.queueBtnDanger]} disabled={busy} onPress={onCancelAll}>
          <Text style={[styles.queueBtnText, { color: '#ff6b6b' }]}>Cancel remaining</Text>
        </TouchableOpacity>
      </View>
      {posts.slice(0, 12).map((p) => (
        <View key={p.id} style={styles.historyRow}>
          <Ionicons
            name={p.publishStatus === 'paused' ? 'pause-circle' : 'time'}
            size={16}
            color={COLORS.primary}
          />
          <View style={{ flex: 1 }}>
            <Text style={styles.historyHandle} numberOfLines={1}>
              {(p.title || p.caption || 'Video').toString().slice(0, 42)}
            </Text>
            <Text style={styles.historyPlatform}>
              {p.publishStatus === 'paused' ? 'Paused' : `Goes live ${formatPublishAt(p.publishAt)}`}
            </Text>
          </View>
          <TouchableOpacity disabled={busy} onPress={() => onPublishOne(p.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={[styles.historyStatus, { color: COLORS.primary }]}>Now</Text>
          </TouchableOpacity>
          <TouchableOpacity disabled={busy} onPress={() => onCancelOne(p.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={[styles.historyStatus, { color: '#ff6b6b' }]}>Ô£ò</Text>
          </TouchableOpacity>
        </View>
      ))}
      {posts.length > 12 && (
        <Text style={styles.progressMeta}>+{posts.length - 12} more in the queue</Text>
      )}
    </View>
  );
};

const ImportProgress = ({ request }) => {
  const {
    status, total = 0, done = 0, skipped = 0, failed = 0, scheduled = 0, handle, message, stagger,
  } = request || {};
  const processed = Math.min(total, done + skipped);
  const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;

  const tone =
    status === IMPORT_STATUS.DONE ? COLORS.primary
      : status === IMPORT_STATUS.ERROR ? '#ff6b6b'
        : COLORS.primary;

  const headline =
    status === IMPORT_STATUS.PENDING ? 'Queued'
      : status === IMPORT_STATUS.RUNNING ? `Importing @${handle}…`
        : status === IMPORT_STATUS.DONE
          ? (stagger?.enabled
            ? `Imported ${done} ┬À publishing ~${stagger.postsPerDay || 3}/day`
            : `Imported ${done} video${done === 1 ? '' : 's'} from @${handle}`)
          : status === IMPORT_STATUS.ERROR ? 'Import hit a snag'
            : status === IMPORT_STATUS.CANCELED ? 'Import canceled'
              : 'Import';

  const icon =
    status === IMPORT_STATUS.DONE ? 'checkmark-circle'
      : status === IMPORT_STATUS.ERROR ? 'alert-circle'
        : 'sync';

  return (
    <View style={[styles.progressCard, { borderColor: tone }]}>
      <View style={styles.progressHead}>
        <Ionicons name={icon} size={18} color={tone} />
        <Text style={[styles.progressTitle, { color: tone }]}>{headline}</Text>
      </View>

      {isImportActive(request) && (
        <View style={styles.barTrack}>
          <View
            style={[
              styles.barFill,
              status === IMPORT_STATUS.RUNNING && total > 0
                ? { width: `${pct}%` }
                : { width: '100%', opacity: 0.45 },
            ]}
          />
        </View>
      )}

      {status === IMPORT_STATUS.RUNNING && total > 0 && (
        <Text style={styles.progressMeta}>
          {processed} of {total} ÔÇó {pct}%{skipped ? ` ÔÇó ${skipped} already imported (skipped)` : ''}
          {scheduled ? ` ÔÇó ${scheduled} queued to publish` : ''}
        </Text>
      )}

      {status === IMPORT_STATUS.RUNNING && total === 0 && (
        <View style={styles.indeterminateRow}>
          <ActivityIndicator color={COLORS.primary} />
          <Text style={styles.progressMeta}>Working… large accounts can take a few minutes.</Text>
        </View>
      )}

      {status === IMPORT_STATUS.PENDING && (
        <View style={styles.indeterminateRow}>
          <ActivityIndicator color={COLORS.primary} />
          <Text style={styles.progressMeta}>Queued — starting shortly…</Text>
        </View>
      )}

      {status === IMPORT_STATUS.DONE && (
        <Text style={styles.progressMeta}>
          {stagger?.enabled
            ? `Uploaded and queued — theyÔÇÖll go live on your pace${skipped ? ` ÔÇó ${skipped} already there` : ''}${failed ? ` ÔÇó ${failed} couldnÔÇÖt import` : ''}.`
            : `TheyÔÇÖre live on your profile now${skipped ? ` ÔÇó ${skipped} already there` : ''}${failed ? ` ÔÇó ${failed} couldnÔÇÖt import` : ''}.`}
        </Text>
      )}

      {!!message && status !== IMPORT_STATUS.DONE && <Text style={styles.progressMsg}>{message}</Text>}
    </View>
  );
};

const ImportHistory = ({ imports }) => {
  if (!Array.isArray(imports) || imports.length === 0) return null;

  const labelFor = (platformId) =>
    IMPORT_PLATFORMS.find((p) => p.id === platformId)?.label || 'TikTok';

  const statusMeta = (status, done = 0) => {
    if (status === IMPORT_STATUS.DONE) return { icon: 'checkmark-circle', color: COLORS.primary, text: `${done} imported` };
    if (status === IMPORT_STATUS.ERROR) return { icon: 'alert-circle', color: '#ff6b6b', text: 'Hit a snag' };
    if (status === IMPORT_STATUS.RUNNING) return { icon: 'sync', color: COLORS.primary, text: 'Importing…' };
    if (status === IMPORT_STATUS.PENDING) return { icon: 'time', color: COLORS.textSecondary, text: 'Queued' };
    if (status === IMPORT_STATUS.CANCELED) return { icon: 'close-circle', color: COLORS.textMuted, text: 'Canceled' };
    return { icon: 'ellipse', color: COLORS.textMuted, text: status || '' };
  };

  return (
    <View style={styles.historyWrap}>
      <Text style={styles.sectionLabel}>Your imports</Text>
      {imports.map((r) => {
        const meta = statusMeta(r?.status, r?.done);
        return (
          <View key={r.id} style={styles.historyRow}>
            <Ionicons name={meta.icon} size={16} color={meta.color} />
            <Text style={styles.historyHandle} numberOfLines={1}>
              @{r?.handle}
              <Text style={styles.historyPlatform}>  ┬À  {labelFor(r?.platform)}</Text>
            </Text>
            <Text style={[styles.historyStatus, { color: meta.color }]}>{meta.text}</Text>
          </View>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: responsiveSize(8),
    marginBottom: 6,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { color: COLORS.textPrimary, fontSize: responsiveFont(18), fontWeight: '800' },
  scroll: { paddingHorizontal: 16, paddingBottom: 120 },

  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(0,210,190,0.10)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(0,210,190,0.35)',
    padding: 14,
    marginTop: 12,
    marginBottom: 18,
  },
  heroText: { flex: 1, color: COLORS.textPrimary, fontSize: responsiveFont(13), lineHeight: responsiveFont(19), fontWeight: '600' },

  sectionLabel: { color: COLORS.textSecondary, fontSize: responsiveFont(12), fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10 },

  platformRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  platformChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.backgroundCard,
  },
  platformChipSelected: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  platformChipDisabled: { opacity: 0.5 },
  platformText: { color: COLORS.textSecondary, fontSize: responsiveFont(13), fontWeight: '700' },
  platformTextSelected: { color: '#001b18' },
  soonTag: { color: COLORS.textMuted, fontSize: responsiveFont(10), fontWeight: '700', marginLeft: 2 },

  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.backgroundCard,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    marginBottom: 16,
  },
  at: { color: COLORS.textMuted, fontSize: responsiveFont(16), fontWeight: '800', marginRight: 4 },
  input: { flex: 1, color: COLORS.textPrimary, fontSize: responsiveFont(15), paddingVertical: 14 },

  ownRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 18 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkboxOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  ownText: { flex: 1, color: COLORS.textSecondary, fontSize: responsiveFont(13), lineHeight: responsiveFont(19) },

  errorText: { color: '#ff6b6b', fontSize: responsiveFont(13), marginBottom: 12 },

  cta: { borderRadius: 12, paddingVertical: 15, alignItems: 'center', justifyContent: 'center' },
  ctaPrimary: { backgroundColor: COLORS.primary },
  ctaDisabled: { backgroundColor: COLORS.backgroundCard, borderWidth: 1, borderColor: COLORS.border },
  ctaText: { color: '#001b18', fontSize: responsiveFont(15), fontWeight: '800' },

  progressCard: {
    marginTop: 18,
    backgroundColor: COLORS.backgroundCard,
    borderRadius: 14,
    borderWidth: 1.5,
    padding: 16,
  },
  progressHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  progressTitle: { fontSize: responsiveFont(14), fontWeight: '800', flex: 1 },
  indeterminateRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  barTrack: { height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.10)', overflow: 'hidden', marginTop: 4 },
  barFill: { height: 8, borderRadius: 4, backgroundColor: COLORS.primary },
  progressMeta: { color: COLORS.textSecondary, fontSize: responsiveFont(12), fontWeight: '600', marginTop: 8 },
  progressMsg: { color: COLORS.textMuted, fontSize: responsiveFont(12), lineHeight: responsiveFont(18), marginTop: 6 },

  helperNote: { color: COLORS.textMuted, fontSize: responsiveFont(12), lineHeight: responsiveFont(18), marginTop: 10, textAlign: 'center' },

  howItWorksCard: {
    marginTop: 16,
    backgroundColor: 'rgba(20,184,166,0.06)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(20,184,166,0.25)',
    paddingVertical: 14,
    paddingHorizontal: 14,
    gap: 12,
  },
  howRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  howText: { flex: 1, color: COLORS.textSecondary, fontSize: responsiveFont(12.5), lineHeight: responsiveFont(18) },

  stallCard: {
    marginTop: 16,
    backgroundColor: 'rgba(251,191,36,0.08)',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: 'rgba(251,191,36,0.5)',
    padding: 16,
  },
  cancelBtn: {
    marginTop: 12,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#ff6b6b',
  },
  cancelText: { color: '#ff6b6b', fontSize: responsiveFont(14), fontWeight: '800' },

  historyWrap: { marginTop: 22 },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: COLORS.backgroundCard,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  historyHandle: { flex: 1, color: COLORS.textPrimary, fontSize: responsiveFont(13), fontWeight: '700' },
  historyPlatform: { color: COLORS.textMuted, fontSize: responsiveFont(12), fontWeight: '600' },
  historyStatus: { fontSize: responsiveFont(12), fontWeight: '700' },

  queueBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.backgroundCard,
  },
  queueBtnDanger: { borderColor: 'rgba(255,107,107,0.5)' },
  queueBtnText: { color: COLORS.textSecondary, fontSize: responsiveFont(12), fontWeight: '700' },

  footNote: { color: COLORS.textMuted, fontSize: responsiveFont(12), lineHeight: responsiveFont(18), marginTop: 18 },
});

export default ImportContentScreen;
