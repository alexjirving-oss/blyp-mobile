/**
 * MarbleRaceOverlay — translucent race layer over live video.
 * BattleOverlay-class density (faces/chat stay visible), not Artillery opaque takeover.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import {
  marbleStart,
  marbleNextHeat,
  marbleEnd,
  marblePick,
  marbleGetState,
} from '../../api/ivsLiveApi';
import { subscribeToMarbleGameEvents } from '../../realtime/marbleGameSocket';

const PHASE_LABEL = {
  lobby: 'Pick a marble',
  lock: 'Locking…',
  heat: 'Racing!',
  podium: 'Podium',
  ended: 'Race over',
};

export default function MarbleRaceOverlay({
  sessionId,
  isHost,
  currentUid,
  hostName,
  liveGuestCount = 0,
  onInviteGuest,
  onClose,
  /** When false, hide host start/invite chrome until Games tab opens (active race still shows). */
  controlsVisible = true,
}) {
  const [event, setEvent] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [myPick, setMyPick] = useState(null);
  const subRef = useRef(null);
  const active = event?.state && event.state.phase !== 'ended';

  const applyEvent = useCallback((payload) => {
    if (!payload || payload.game !== 'marble') return;
    if (payload.sessionId && payload.sessionId !== sessionId) return;
    setEvent(payload);
    setErr(null);
  }, [sessionId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snap = await marbleGetState(sessionId);
        if (!cancelled && snap) applyEvent(snap);
      } catch {
        // no active race yet
      }
      try {
        const sub = await subscribeToMarbleGameEvents(sessionId, (p) => {
          if (!cancelled) applyEvent(p);
        });
        if (cancelled) sub.close();
        else subRef.current = sub;
      } catch (e) {
        if (!cancelled) setErr(e?.message || 'Socket failed');
      }
    })();
    return () => {
      cancelled = true;
      try { subRef.current?.close?.(); } catch { /* ignore */ }
      subRef.current = null;
    };
  }, [sessionId, applyEvent]);

  const start = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await marbleStart(sessionId, { hostName });
      applyEvent(res);
    } catch (e) {
      const code = String(e?.code || e?.message || '');
      if (/NEED_GUESTS|NEED_RACERS/i.test(code)) {
        setErr('Invite a guest to Race, or try again in a moment.');
      } else {
        setErr(e?.message || e?.code || 'Start failed');
      }
    } finally {
      setBusy(false);
    }
  };

  const nextHeat = async () => {
    setBusy(true);
    try {
      const res = await marbleNextHeat(sessionId);
      applyEvent(res);
      setMyPick(null);
    } catch (e) {
      setErr(e?.message || e?.code || 'Next heat failed');
    } finally {
      setBusy(false);
    }
  };

  const end = async () => {
    setBusy(true);
    try {
      const res = await marbleEnd(sessionId);
      applyEvent(res);
      onClose?.();
    } catch (e) {
      setErr(e?.message || e?.code || 'End failed');
    } finally {
      setBusy(false);
    }
  };

  const pick = async (racerUserId) => {
    if (event?.state?.phase !== 'lobby') return;
    setMyPick(racerUserId);
    try {
      const res = await marblePick(sessionId, racerUserId);
      applyEvent(res);
    } catch (e) {
      setErr(e?.message || e?.code || 'Pick failed');
    }
  };

  const state = event?.state;
  const marbles = state?.marbles || [];
  const phase = state?.phase;
  // Host Race CTA is always available when the client flag is on (solo practice
  // pads on the server when no guests are LIVE).
  const canStart = isHost && !active && !!sessionId;
  const soloPractice = isHost && !active && liveGuestCount < 1;

  return (
    <View style={styles.root} pointerEvents="box-none">
      {active ? (
        <View style={styles.trackBand} pointerEvents="box-none">
          <View style={styles.headerRow} pointerEvents="box-none">
            <Text style={styles.phaseText} allowFontScaling={false}>
              {PHASE_LABEL[phase] || phase} · Heat {(state.heatIndex || 0) + 1}/{state.heatsTotal || 3}
            </Text>
            {isHost ? (
              <View style={styles.hostBtns}>
                {(phase === 'podium' || phase === 'lobby') && (
                  <TouchableOpacity style={styles.smallBtn} onPress={nextHeat} disabled={busy}>
                    <Text style={styles.smallBtnText}>Next</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={[styles.smallBtn, styles.endBtn]} onPress={end} disabled={busy}>
                  <Text style={styles.smallBtnText}>End</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>

          <View style={styles.lanes}>
            {marbles.map((m) => {
              const pct = Math.max(0, Math.min(1, m.progress || 0));
              const boosted = state.tick < (m.boostUntilTick || 0);
              return (
                <View key={m.userId} style={styles.laneRow}>
                  <View style={[styles.swatch, { backgroundColor: m.color }]} />
                  <Text style={styles.laneName} numberOfLines={1} allowFontScaling={false}>
                    {m.displayName}
                    {m.place ? ` · #${m.place}` : ''}
                    {boosted ? ' 💨' : ''}
                  </Text>
                  <View style={styles.track}>
                    <View
                      style={[
                        styles.marble,
                        {
                          backgroundColor: m.color,
                          left: `${pct * 88}%`,
                          opacity: boosted ? 1 : 0.92,
                          transform: [{ scale: boosted ? 1.15 : 1 }],
                        },
                      ]}
                    />
                    <View style={styles.finishLine} />
                  </View>
                  <Text style={styles.pts} allowFontScaling={false}>
                    {state.placePoints?.[m.userId] ?? 0}
                  </Text>
                </View>
              );
            })}
          </View>

          {phase === 'lobby' ? (
            <View style={styles.pickRow}>
              {marbles.map((m) => {
                const selected = myPick === m.userId || state.picks?.[currentUid] === m.userId;
                return (
                  <TouchableOpacity
                    key={`pick-${m.userId}`}
                    style={[styles.pickChip, selected && { borderColor: m.color, backgroundColor: `${m.color}33` }]}
                    onPress={() => pick(m.userId)}
                  >
                    <Text style={styles.pickChipText} allowFontScaling={false}>
                      {m.displayName}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : null}

          {phase === 'podium' ? (
            <View style={styles.podium}>
              {[...marbles]
                .filter((m) => m.place)
                .sort((a, b) => (a.place || 99) - (b.place || 99))
                .slice(0, 3)
                .map((m) => (
                  <Text key={`pod-${m.userId}`} style={styles.podiumLine} allowFontScaling={false}>
                    #{m.place} {m.displayName} · {state.placePoints?.[m.userId] ?? 0} pts
                  </Text>
                ))}
            </View>
          ) : null}
        </View>
      ) : null}

      {isHost && !active && controlsVisible ? (
        <View style={styles.hostRaceCluster} pointerEvents="box-none">
          <View style={styles.hintCard} pointerEvents="box-none">
            <Text style={styles.hintText} allowFontScaling={false}>
              {soloPractice
                ? 'Marble Race — solo practice, or invite a guest'
                : 'Marble Race — start when ready'}
            </Text>
            {typeof onInviteGuest === 'function' && soloPractice ? (
              <TouchableOpacity
                style={styles.inviteBtn}
                onPress={onInviteGuest}
                activeOpacity={0.85}
              >
                <Text style={styles.inviteBtnText} allowFontScaling={false}>
                  Invite a guest
                </Text>
              </TouchableOpacity>
            ) : null}
            {typeof onClose === 'function' ? (
              <TouchableOpacity style={styles.closeChip} onPress={onClose} activeOpacity={0.85}>
                <Text style={styles.closeChipText} allowFontScaling={false}>Close</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          <TouchableOpacity
            style={styles.startFab}
            onPress={start}
            disabled={busy || !canStart}
            activeOpacity={0.85}
            accessibilityLabel="Start Marble Race"
            accessibilityRole="button"
          >
            {busy ? (
              <ActivityIndicator color="#0A0A0C" />
            ) : (
              <Text style={styles.startFabText} allowFontScaling={false}>
                {soloPractice ? 'Start Race' : 'Start Marble Race'}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      ) : null}

      {err ? (
        <View style={styles.errBanner} pointerEvents="none">
          <Text style={styles.errText} allowFontScaling={false}>{String(err)}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, zIndex: 45 },
  trackBand: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 96,
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 10,
    backgroundColor: 'rgba(10, 14, 18, 0.48)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.18)',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  phaseText: { color: '#F4F7FA', fontWeight: '800', fontSize: 13, letterSpacing: 0.2 },
  hostBtns: { flexDirection: 'row', gap: 6 },
  smallBtn: {
    backgroundColor: '#FF2D55',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  endBtn: { backgroundColor: '#FF5A5F' },
  smallBtnText: { color: '#FFFFFF', fontWeight: '800', fontSize: 11 },
  lanes: { gap: 5 },
  laneRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 10, height: 10, borderRadius: 5 },
  laneName: { width: 72, color: '#E8EEF4', fontSize: 11, fontWeight: '700' },
  track: {
    flex: 1,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(255,255,255,0.12)',
    overflow: 'hidden',
    justifyContent: 'center',
  },
  marble: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.7)',
  },
  finishLine: {
    position: 'absolute',
    right: 4,
    top: 2,
    bottom: 2,
    width: 2,
    backgroundColor: 'rgba(255,255,255,0.45)',
  },
  pts: { width: 22, textAlign: 'right', color: '#B8C4D0', fontSize: 11, fontWeight: '700' },
  pickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  pickChip: {
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.25)',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  pickChipText: { color: '#F4F7FA', fontSize: 11, fontWeight: '700' },
  podium: { marginTop: 8, gap: 2 },
  podiumLine: { color: '#F4F7FA', fontWeight: '800', fontSize: 12 },
  hostRaceCluster: {
    position: 'absolute',
    right: 14,
    bottom: 200,
    alignItems: 'flex-end',
    zIndex: 55,
    gap: 8,
    maxWidth: 220,
  },
  hintCard: {
    backgroundColor: 'rgba(10, 14, 18, 0.82)',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,176,32,0.55)',
    gap: 8,
    alignItems: 'stretch',
  },
  hintText: {
    color: '#F4F7FA',
    fontWeight: '700',
    fontSize: 12,
    lineHeight: 16,
  },
  inviteBtn: {
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
    alignItems: 'center',
  },
  inviteBtnText: { color: '#FFB020', fontWeight: '800', fontSize: 12 },
  closeChip: {
    alignSelf: 'center',
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  closeChipText: { color: 'rgba(244,247,250,0.7)', fontWeight: '700', fontSize: 11 },
  startFab: {
    backgroundColor: '#FFB020',
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 22,
    minWidth: 96,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  startFabText: { color: '#0A0A0C', fontWeight: '900', fontSize: 13 },
  errBanner: {
    position: 'absolute',
    top: 56,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(180,40,40,0.85)',
    padding: 8,
    borderRadius: 8,
  },
  errText: { color: '#fff', fontSize: 12, textAlign: 'center' },
});
