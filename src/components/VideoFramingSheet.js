import React, { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Modal,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Icon from './Icon';
import PremiumFeedVideo from './Feed/PremiumFeedVideo';
import { COLORS } from '../styles/theme';
import { updatePostMediaDisplay } from '../services/postEditService';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function normalizeDisplay(raw) {
  return {
    fitMode: ['auto', 'cover', 'contain'].includes(raw?.fitMode) ? raw.fitMode : 'cover',
    scale: clamp(Number(raw?.scale) || 1, 1, 2.5),
    offsetX: clamp(Number(raw?.offsetX) || 0, -1, 1),
    offsetY: clamp(Number(raw?.offsetY) || 0, -1, 1),
  };
}

/**
 * Owner-only sheet: change how a posted video sits in the frame (fit + pan/zoom).
 * Saves display metadata only — no re-encode.
 */
export default function VideoFramingSheet({
  visible,
  onClose,
  post,
  videoUri,
  poster,
  onSaved,
}) {
  const initial = useMemo(() => normalizeDisplay(post?.mediaDisplay), [post?.id, visible]);
  const [fitMode, setFitMode] = useState(initial.fitMode === 'auto' ? 'cover' : initial.fitMode);
  const [scale, setScale] = useState(initial.scale);
  const [offsetX, setOffsetX] = useState(initial.offsetX);
  const [offsetY, setOffsetY] = useState(initial.offsetY);
  const [saving, setSaving] = useState(false);

  const dragStart = useRef({ x: 0, y: 0 });
  const live = useRef({ x: offsetX, y: offsetY });
  live.current = { x: offsetX, y: offsetY };

  React.useEffect(() => {
    if (!visible) return;
    const next = normalizeDisplay(post?.mediaDisplay);
    setFitMode(next.fitMode === 'auto' ? 'cover' : next.fitMode);
    setScale(next.scale);
    setOffsetX(next.offsetX);
    setOffsetY(next.offsetY);
  }, [visible, post?.id]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          dragStart.current = { x: live.current.x, y: live.current.y };
        },
        onPanResponderMove: (_e, g) => {
          const nx = clamp(dragStart.current.x + g.dx / (SCREEN_W * 0.45), -1, 1);
          const ny = clamp(dragStart.current.y + g.dy / (SCREEN_H * 0.45), -1, 1);
          setOffsetX(nx);
          setOffsetY(ny);
        },
      }),
    [],
  );

  const display = { fitMode, scale, offsetX, offsetY };

  const handleSave = async () => {
    if (!post?.id || saving) return;
    setSaving(true);
    try {
      const res = await updatePostMediaDisplay(post.id, display);
      if (!res?.ok) {
        onClose?.();
        return;
      }
      onSaved?.(res.mediaDisplay);
      onClose?.();
    } finally {
      setSaving(false);
    }
  };

  const bumpScale = (delta) => setScale((s) => clamp(Number((s + delta).toFixed(2)), 1, 2.5));

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.preview} {...panResponder.panHandlers}>
          <PremiumFeedVideo
            uri={videoUri}
            poster={poster}
            style={StyleSheet.absoluteFill}
            shouldPlay
            shouldLoad
            paused={false}
            isMuted
            isLooping
            showChrome={false}
            mediaDisplay={display}
          />
          <View style={styles.frameGuide} pointerEvents="none" />
        </View>

        <View style={styles.controls}>
          <View style={styles.topRow}>
            <TouchableOpacity onPress={onClose} hitSlop={12}>
              <Text style={styles.cancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.title}>Adjust framing</Text>
            <TouchableOpacity onPress={handleSave} disabled={saving} hitSlop={12}>
              {saving ? <ActivityIndicator color={COLORS.primary} /> : <Text style={styles.save}>Save</Text>}
            </TouchableOpacity>
          </View>

          <Text style={styles.hint}>Drag to reposition · zoom with + / −</Text>

          <View style={styles.modeRow}>
            {['cover', 'contain'].map((mode) => (
              <TouchableOpacity
                key={mode}
                style={[styles.modeBtn, fitMode === mode && styles.modeBtnActive]}
                onPress={() => setFitMode(mode)}
              >
                <Text style={[styles.modeText, fitMode === mode && styles.modeTextActive]}>
                  {mode === 'cover' ? 'Fill' : 'Fit'}
                </Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={() => bumpScale(-0.1)}
              accessibilityLabel="Zoom out"
            >
              <Icon name="remove" size={20} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.scaleLabel}>{Math.round(scale * 100)}%</Text>
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={() => bumpScale(0.1)}
              accessibilityLabel="Zoom in"
            >
              <Icon name="add" size={20} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={() => {
                setScale(1);
                setOffsetX(0);
                setOffsetY(0);
                setFitMode('cover');
              }}
            >
              <Icon name="refresh" size={18} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0A0A0C' },
  preview: { flex: 1, overflow: 'hidden', backgroundColor: '#000' },
  frameGuide: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    margin: 18,
    borderRadius: 12,
  },
  controls: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 28,
    backgroundColor: '#121214',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  title: { color: '#fff', fontSize: 16, fontWeight: '700' },
  cancel: { color: 'rgba(255,255,255,0.7)', fontSize: 15 },
  save: { color: COLORS.primary, fontSize: 15, fontWeight: '700' },
  hint: { color: 'rgba(255,255,255,0.45)', fontSize: 12, marginBottom: 12 },
  modeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  modeBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  modeBtnActive: { backgroundColor: COLORS.primary },
  modeText: { color: 'rgba(255,255,255,0.75)', fontSize: 13, fontWeight: '600' },
  modeTextActive: { color: '#0A0A0C' },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  scaleLabel: { color: '#fff', width: 44, textAlign: 'center', fontSize: 13, fontWeight: '600' },
});
