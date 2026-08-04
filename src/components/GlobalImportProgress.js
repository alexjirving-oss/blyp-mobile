// GlobalImportProgress.js
//
// A slim, app-wide progress banner for the "Bring your content" import.
// It mounts once at the app root (inside NavigationContainer) and stays visible
// as the user navigates away from the Import screen, so they can always see
// their account's videos being brought over. Tapping it reopens the import
// screen; a terminal state (done/error) shows briefly then auto-hides.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Platform, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../styles/theme';
import { responsiveFont } from '../utils/scaleUtils';
import { useAuth } from '../hooks/useCommon';
import {
  IMPORT_STATUS,
  isImportActive,
  subscribeLatestImport,
} from '../services/socialImportService';

// How long a finished (done/error/canceled) import stays on screen before it
// auto-dismisses itself.
const TERMINAL_VISIBLE_MS = 8000;

// An "active" (pending/running) job whose doc hasn't been touched in this long is
// treated as a zombie (e.g. the import worker died) and the banner is hidden — so
// a stuck job from a previous session can't pin the banner up forever.
const STALE_ACTIVE_MS = 15 * 60 * 1000;

// A finished job is only surfaced if it ended recently. This stops an old,
// already-completed import from flashing the banner for 8s on every cold start.
const RECENT_TERMINAL_MS = 60 * 1000;

// Top offset that clears the status bar without needing a SafeAreaProvider at
// the app root (the app doesn't wrap itself in one).
const TOP_INSET = Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 48;

const GlobalImportProgress = ({ navigationRef }) => {
  const { uid } = useAuth();

  const [request, setRequest] = useState(null);
  const [routeName, setRouteName] = useState(null);
  const [dismissedId, setDismissedId] = useState(null);
  const [nowTick, setNowTick] = useState(Date.now());
  const slide = useRef(new Animated.Value(-120)).current;

  // Live subscription to the user's most recent import request.
  useEffect(() => {
    if (!uid) {
      setRequest(null);
      return undefined;
    }
    const unsub = subscribeLatestImport(uid, setRequest);
    return () => { try { unsub && unsub(); } catch { /* ignore */ } };
  }, [uid]);

  // Track the current route so we can hide the banner on the Import screen
  // itself (where the full progress card already lives).
  useEffect(() => {
    const ref = navigationRef?.current || navigationRef;
    if (!ref?.addListener) return undefined;
    const sync = () => {
      try { setRouteName(ref.getCurrentRoute?.()?.name || null); } catch { /* ignore */ }
    };
    sync();
    const unsub = ref.addListener('state', sync);
    return () => { try { unsub && unsub(); } catch { /* ignore */ } };
  }, [navigationRef]);

  const status = request?.status;
  const isActive = isImportActive(request);
  const isTerminal =
    status === IMPORT_STATUS.DONE ||
    status === IMPORT_STATUS.ERROR ||
    status === IMPORT_STATUS.CANCELED;

  // Auto-dismiss a finished import after a short window so the banner doesn't
  // linger forever. Active imports stay until they finish.
  useEffect(() => {
    if (!request || !isTerminal) return undefined;
    const id = request.id;
    const t = setTimeout(() => setDismissedId(id), TERMINAL_VISIBLE_MS);
    return () => clearTimeout(t);
  }, [request, isTerminal]);

  // While a job is active, re-evaluate every 20s so a job that silently stalls
  // (worker died, no further doc updates) eventually trips the staleness guard
  // and the banner slides away on its own.
  useEffect(() => {
    if (!isActive) return undefined;
    const t = setInterval(() => setNowTick(Date.now()), 20000);
    return () => clearInterval(t);
  }, [isActive]);

  // Freshness of the underlying job, from its last write.
  const lastTouch = Number(request?.updatedAt || request?.createdAt || 0);
  const age = lastTouch ? Math.max(0, nowTick - lastTouch) : Infinity;
  const isStaleActive = isActive && age > STALE_ACTIVE_MS;
  const isRecentTerminal = isTerminal && age <= RECENT_TERMINAL_MS;

  const visible =
    !!request &&
    request.id !== dismissedId &&
    routeName !== 'ImportContent' &&
    ((isActive && !isStaleActive) || isRecentTerminal);

  // Slide the banner in/out.
  useEffect(() => {
    Animated.timing(slide, {
      toValue: visible ? 0 : -120,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [visible, slide]);

  const onPress = useCallback(() => {
    try {
      const ref = navigationRef?.current || navigationRef;
      if (ref?.isReady?.()) ref.navigate('ImportContent');
    } catch { /* ignore */ }
  }, [navigationRef]);

  const onDismiss = useCallback(() => {
    if (request?.id) setDismissedId(request.id);
  }, [request]);

  const { total = 0, done = 0, handle } = request || {};
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;

  const tone = useMemo(() => {
    if (status === IMPORT_STATUS.ERROR) return '#ff6b6b';
    return COLORS.primary;
  }, [status]);

  const label = useMemo(() => {
    switch (status) {
      case IMPORT_STATUS.PENDING:
        return `Queued — bringing @${handle} over`;
      case IMPORT_STATUS.RUNNING:
        return total > 0
          ? `Importing @${handle} — ${done} of ${total}`
          : `Importing @${handle}…`;
      case IMPORT_STATUS.DONE:
        return `Imported ${done} video${done === 1 ? '' : 's'} from @${handle}`;
      case IMPORT_STATUS.ERROR:
        return `Import of @${handle} hit a snag`;
      case IMPORT_STATUS.CANCELED:
        return `Import of @${handle} canceled`;
      default:
        return 'Import';
    }
  }, [status, handle, total, done]);

  const icon =
    status === IMPORT_STATUS.DONE ? 'checkmark-circle'
      : status === IMPORT_STATUS.ERROR ? 'alert-circle'
        : 'cloud-download-outline';

  // Determinate bar while running with a known total; otherwise a full-width
  // pulse track so there's always a visible "working" bar.
  const indeterminate = isActive && !(status === IMPORT_STATUS.RUNNING && total > 0);
  const barWidth = isTerminal ? '100%' : (total > 0 ? `${pct}%` : '100%');

  if (!request) return null;

  return (
    <Animated.View
      pointerEvents={visible ? 'box-none' : 'none'}
      style={[
        styles.wrap,
        { paddingTop: TOP_INSET + 4, transform: [{ translateY: slide }] },
      ]}
    >
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={onPress}
        style={[styles.card, { borderColor: tone }]}
      >
        <View style={styles.row}>
          <Ionicons name={icon} size={18} color={tone} />
          <Text style={styles.label} numberOfLines={1}>{label}</Text>
          {(status === IMPORT_STATUS.RUNNING && total > 0) && (
            <Text style={[styles.pct, { color: tone }]}>{pct}%</Text>
          )}
          <TouchableOpacity
            onPress={onDismiss}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={styles.closeBtn}
          >
            <Ionicons name="close" size={16} color={COLORS.textMuted} />
          </TouchableOpacity>
        </View>

        <View style={styles.barTrack}>
          <View
            style={[
              styles.barFill,
              { width: barWidth, backgroundColor: tone, opacity: indeterminate ? 0.5 : 1 },
            ]}
          />
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 12,
    zIndex: 9999,
    elevation: 9999,
  },
  card: {
    backgroundColor: COLORS.backgroundCard,
    borderRadius: 12,
    borderWidth: 1.5,
    paddingHorizontal: 12,
    paddingVertical: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { flex: 1, color: COLORS.textPrimary, fontSize: responsiveFont(12.5), fontWeight: '700' },
  pct: { fontSize: responsiveFont(12), fontWeight: '800' },
  closeBtn: { padding: 2, marginLeft: 2 },
  barTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.10)',
    overflow: 'hidden',
    marginTop: 8,
  },
  barFill: { height: 6, borderRadius: 3 },
});

export default GlobalImportProgress;
