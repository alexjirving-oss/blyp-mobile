// GlobalPostUploadProgress.js
//
// App-wide banner for background post publishes. Mirrors GlobalImportProgress
// so users can leave Review immediately and still see compress/upload %.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Platform, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import { COLORS } from '../styles/theme';
import { responsiveFont } from '../utils/scaleUtils';
import {
  POST_UPLOAD_STATUS,
  dismissPostUpload,
  getActivePostUpload,
  isPostUploadActive,
  retryPostUpload,
  subscribePostUploads,
} from '../services/postUploadQueue';

const TERMINAL_VISIBLE_MS = 8000;
const TOP_INSET = Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 48;

const GlobalPostUploadProgress = () => {
  const [job, setJob] = useState(null);
  const [dismissedId, setDismissedId] = useState(null);
  const slide = useRef(new Animated.Value(-120)).current;
  const lastToastKey = useRef(null);

  useEffect(() => {
    const unsub = subscribePostUploads(() => {
      setJob(getActivePostUpload());
    });
    return () => {
      try {
        unsub && unsub();
      } catch {
        /* ignore */
      }
    };
  }, []);

  // Toast on terminal transitions (success / hard fail).
  useEffect(() => {
    if (!job?.id) return;
    const key = `${job.id}:${job.status}`;
    if (lastToastKey.current === key) return;
    if (job.status === POST_UPLOAD_STATUS.DONE) {
      lastToastKey.current = key;
      Toast.show({
        type: 'success',
        text1: 'Post created!',
        text2: 'Your post is now live',
        position: 'bottom',
      });
    } else if (job.status === POST_UPLOAD_STATUS.ERROR) {
      lastToastKey.current = key;
      Toast.show({
        type: 'error',
        text1: 'Upload failed',
        text2: 'Tap the banner to retry',
        position: 'bottom',
      });
    }
  }, [job?.id, job?.status]);

  useEffect(() => {
    if (!job || job.status !== POST_UPLOAD_STATUS.DONE) return undefined;
    const id = job.id;
    const t = setTimeout(() => setDismissedId(id), TERMINAL_VISIBLE_MS);
    return () => clearTimeout(t);
  }, [job?.id, job?.status]);

  const isActive = isPostUploadActive(job);
  const isTerminal =
    job?.status === POST_UPLOAD_STATUS.DONE || job?.status === POST_UPLOAD_STATUS.ERROR;

  const visible =
    !!job &&
    job.id !== dismissedId &&
    (isActive || isTerminal);

  useEffect(() => {
    Animated.timing(slide, {
      toValue: visible ? 0 : -120,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [visible, slide]);

  const onPress = useCallback(() => {
    if (!job) return;
    if (job.status === POST_UPLOAD_STATUS.ERROR) {
      retryPostUpload(job.id);
      return;
    }
  }, [job]);

  const onDismiss = useCallback(() => {
    if (!job?.id) return;
    if (isPostUploadActive(job)) {
      setDismissedId(job.id);
      return;
    }
    dismissPostUpload(job.id);
    setDismissedId(job.id);
  }, [job]);

  const tone = useMemo(() => {
    if (job?.status === POST_UPLOAD_STATUS.ERROR) return '#ff6b6b';
    if (job?.status === POST_UPLOAD_STATUS.DONE) return '#34d399';
    return COLORS.primary;
  }, [job?.status]);

  const pct = Math.min(100, Math.max(0, Number(job?.progressPct) || 0));
  const label = job?.statusText || 'Uploading…';

  const icon =
    job?.status === POST_UPLOAD_STATUS.DONE
      ? 'checkmark-circle'
      : job?.status === POST_UPLOAD_STATUS.ERROR
        ? 'alert-circle'
        : 'cloud-upload-outline';

  const indeterminate = isActive && pct < 5;
  const barWidth = isTerminal ? '100%' : `${Math.max(indeterminate ? 30 : pct, 8)}%`;

  if (!job) return null;

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
          {isActive && pct > 0 ? (
            <Text style={[styles.pct, { color: tone }]}>{pct}%</Text>
          ) : null}
          {job.status === POST_UPLOAD_STATUS.ERROR ? (
            <Text style={[styles.retry, { color: tone }]}>Retry</Text>
          ) : null}
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
              { width: barWidth, backgroundColor: tone, opacity: indeterminate ? 0.55 : 1 },
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
    zIndex: 9998,
    elevation: 9998,
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
  retry: { fontSize: responsiveFont(12), fontWeight: '800' },
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

export default GlobalPostUploadProgress;
