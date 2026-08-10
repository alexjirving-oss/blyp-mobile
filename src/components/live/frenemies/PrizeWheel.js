/**
 * Frenemies prize wheel — 11 segments, right-side pointer, ease-out land
 * on the authoritative server slot (targetSlot / landedSlot).
 * Occupied slots paint guest photo (else initials) when roster is known.
 * Idle (ready) never rotates — only a soft outer glow pulse.
 *
 * Spin: Reanimated native rotation (60fps). Peg ticks are scheduled from the
 * easing curve (no Animated.addListener) so ticks stay consistent with angular
 * velocity without stalling the JS thread.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, {
  G,
  Path,
  Circle,
  Defs,
  LinearGradient as SvgLinearGradient,
  Stop,
} from 'react-native-svg';
import { Audio } from 'expo-av';
import { pickPublicLabel } from '../../../utils/publicLabel';

/** Blyp COLORS — PETRONAS teal, ink chrome, gold prize accents. */
const TEAL_DEEP = '#0A6B62';
const TEAL = '#00D2BE';
const TEAL_DIM = '#00A89E';
const TEAL_LIGHT = '#7FEDE2';
const GOLD = '#F5C542';
const GOLD_SOFT = '#FDE68A';
const GOLD_DARK = '#C9A227';
const INK = '#0A0A0C';
const INK_CARD = '#121216';

/** Pointer sits at 3 o'clock (degrees from top, clockwise). */
const POINTER_DEG = 90;

/** Empty boxes: ink / deep-teal checker — high contrast under gold rim. */
const SEG_COLORS = [
  '#0B2F2C',
  INK_CARD,
  '#0E4A44',
  '#141418',
  '#0B2F2C',
  INK_CARD,
  '#0E4A44',
  '#141418',
  '#0B2F2C',
  INK_CARD,
  '#0E4A44',
];

const SEG_COLORS_ALT = [
  TEAL_DEEP,
  '#15524A',
  '#0F3D38',
  TEAL_DEEP,
  '#15524A',
  '#0F3D38',
  TEAL_DEEP,
  '#15524A',
  '#0F3D38',
  TEAL_DEEP,
  '#15524A',
];

const WHEEL_TICK = require('../../../../assets/sounds/wheel_tick.wav');

function polar(cx, cy, r, deg) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function segmentPath(cx, cy, rOuter, rInner, startDeg, endDeg) {
  const large = endDeg - startDeg > 180 ? 1 : 0;
  const a0 = polar(cx, cy, rOuter, startDeg);
  const a1 = polar(cx, cy, rOuter, endDeg);
  const b1 = polar(cx, cy, rInner, endDeg);
  const b0 = polar(cx, cy, rInner, startDeg);
  return [
    `M ${a0.x} ${a0.y}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${a1.x} ${a1.y}`,
    `L ${b1.x} ${b1.y}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${b0.x} ${b0.y}`,
    'Z',
  ].join(' ');
}

/** Degrees to rotate so slot (1..n) center sits under the right-side pointer. */
export function landRotationForSlot(slot, maxSlots, extraSpins = 8) {
  const n = Math.max(1, maxSlots);
  const i = Math.max(1, Math.min(n, Number(slot) || 1)) - 1;
  const seg = 360 / n;
  const centerFromTop = (i + 0.5) * seg;
  return extraSpins * 360 + POINTER_DEG - centerFromTop;
}

/**
 * Long high-speed phase then smooth ease-out.
 * First ~58% of time covers ~78% of travel; remaining time eases into the land.
 * Worklet so Reanimated can drive native rotation without JS stutter.
 */
export function easeWheelSpin(t) {
  'worklet';
  const x = Math.min(1, Math.max(0, t));
  if (x <= 0.58) {
    return (0.78 * x) / 0.58;
  }
  const u = (x - 0.58) / 0.42;
  const eased = 1 - (1 - u) ** 3;
  return 0.78 + 0.22 * eased;
}

function spinsForDuration(ms) {
  const s = Math.max(0, ms) / 1000;
  // More revolutions + longer coast for a "keeps spinning fast" feel.
  if (s <= 8) return 6;
  if (s <= 20) return 10;
  if (s <= 40) return 14;
  return 18;
}

function segUnderPointer(rotationDeg, maxSlots) {
  const n = Math.max(1, maxSlots);
  const seg = 360 / n;
  const under = ((POINTER_DEG - rotationDeg) % 360 + 360) % 360;
  return Math.floor(under / seg) % n;
}

/**
 * Inverse of easeWheelSpin for scheduling peg-pass ticks at wall-clock times.
 */
function invertEaseWheelSpin(y) {
  const target = Math.min(1, Math.max(0, y));
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 28; i += 1) {
    const mid = (lo + hi) / 2;
    if (easeWheelSpin(mid) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function initialsFor(name) {
  const s = String(name || '').trim().replace(/^@/, '');
  if (!s) return '?';
  return s.slice(0, 1).toUpperCase();
}

function guestLabel(g) {
  if (!g) return null;
  return pickPublicLabel(g, { uid: g.userId, fallback: 'Guest' });
}

function guestPhoto(g) {
  if (!g) return null;
  const u = g.photoUrl || g.photoURL || g.avatarUrl || g.avatar || null;
  return typeof u === 'string' && u.trim() ? u.trim() : null;
}

/** Compact face chip — same quality bar as Frenemies throw grid. */
function SegFace({ uri, name, size = 22 }) {
  const [failedUri, setFailedUri] = useState(null);
  const r = size / 2;
  const showPhoto = !!uri && failedUri !== uri;
  if (showPhoto) {
    return (
      <Image
        source={{ uri }}
        onError={() => setFailedUri(uri)}
        style={{
          width: size,
          height: size,
          borderRadius: r,
          borderWidth: 1.5,
          borderColor: GOLD,
          backgroundColor: 'rgba(255,255,255,0.08)',
        }}
      />
    );
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: r,
        backgroundColor: 'rgba(0,210,190,0.4)',
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1.5,
        borderColor: GOLD,
      }}
    >
      <Text
        style={{ color: '#fff', fontWeight: '900', fontSize: size * 0.42 }}
        allowFontScaling={false}
      >
        {initialsFor(name)}
      </Text>
    </View>
  );
}

export default function PrizeWheel({
  size = 196,
  maxSlots = 11,
  phase,
  roundId,
  targetSlot,
  landedSlot,
  spinStartedAt,
  spinEndsAt,
  occupiedBySlot = {},
}) {
  const spinDeg = useSharedValue(0);
  const pulse = useSharedValue(0);
  const tickSoundRef = useRef(null);
  const tickTimersRef = useRef([]);
  const tickPoolRef = useRef([]);
  const tickPoolIdx = useRef(0);

  const slot = landedSlot || targetSlot;
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = size * 0.44;
  const rInner = size * 0.15;
  const rBezel = rOuter + size * 0.035;
  const seg = 360 / maxSlots;

  const faceSize = Math.max(18, Math.min(28, Math.round(size * 0.125)));

  const segments = useMemo(() => {
    return Array.from({ length: maxSlots }, (_, i) => {
      const start = i * seg;
      const end = (i + 1) * seg;
      const mid = start + seg / 2;
      const labelPos = polar(cx, cy, rOuter * 0.7, mid);
      const stud = polar(cx, cy, rBezel - 1, mid);
      const n = i + 1;
      const guest = occupiedBySlot[n] || occupiedBySlot[String(n)] || null;
      const name = guestLabel(guest) || (guest ? 'Guest' : null);
      const photo = guestPhoto(guest);
      const occupied = !!guest;
      return {
        n,
        path: segmentPath(cx, cy, rOuter, rInner, start, end),
        color: occupied
          ? TEAL_DEEP
          : i % 2 === 0
            ? SEG_COLORS[i % SEG_COLORS.length]
            : SEG_COLORS_ALT[i % SEG_COLORS_ALT.length],
        accent: i % 3 === 0,
        labelPos,
        stud,
        occupied,
        name,
        photo,
      };
    });
  }, [maxSlots, seg, cx, cy, rOuter, rInner, rBezel, occupiedBySlot]);

  useEffect(() => {
    let cancelled = false;
    const pool = [];
    (async () => {
      try {
        // Small pool so rapid peg passes never skip (replayAsync on one sound stalls).
        for (let i = 0; i < 3; i += 1) {
          const { sound } = await Audio.Sound.createAsync(WHEEL_TICK, {
            shouldPlay: false,
            volume: 0.32,
            isLooping: false,
          });
          if (cancelled) {
            await sound.unloadAsync().catch(() => {});
            return;
          }
          pool.push(sound);
        }
        tickPoolRef.current = pool;
        tickSoundRef.current = pool[0] || null;
      } catch {
        // Best-effort — wheel still works silent.
      }
    })();
    return () => {
      cancelled = true;
      tickTimersRef.current.forEach(clearTimeout);
      tickTimersRef.current = [];
      const sounds = tickPoolRef.current.splice(0);
      tickSoundRef.current = null;
      sounds.forEach((s) => s.unloadAsync().catch(() => {}));
    };
  }, []);

  const playTick = () => {
    const pool = tickPoolRef.current;
    if (!pool.length) return;
    const s = pool[tickPoolIdx.current % pool.length];
    tickPoolIdx.current += 1;
    if (!s) return;
    s.replayAsync().catch(() => {
      s.setPositionAsync(0)
        .then(() => s.playAsync())
        .catch(() => {});
    });
  };

  const clearTickTimers = () => {
    tickTimersRef.current.forEach(clearTimeout);
    tickTimersRef.current = [];
  };

  /** Schedule one tick per segment boundary crossed during the remaining spin. */
  const schedulePegTicks = (fromDeg, toDeg, durationMs, maxSlotsLocal) => {
    clearTickTimers();
    if (!(durationMs > 40) || !(toDeg > fromDeg)) return;
    const delta = toDeg - fromDeg;
    const segSize = 360 / Math.max(1, maxSlotsLocal);
    const startSeg = segUnderPointer(fromDeg, maxSlotsLocal);
    let lastSeg = startSeg;
    const crossings = [];
    // Sample rotation progress densely enough to catch every boundary.
    const steps = Math.min(2400, Math.max(80, Math.ceil(delta / (segSize * 0.2))));
    for (let i = 1; i <= steps; i += 1) {
      const p = i / steps;
      const deg = fromDeg + delta * p;
      const idx = segUnderPointer(deg, maxSlotsLocal);
      if (idx !== lastSeg) {
        lastSeg = idx;
        crossings.push(p);
      }
    }
    const startWall = Date.now();
    for (const p of crossings) {
      // Map travel fraction → eased wall time so ticks match perceived speed.
      const tNorm = invertEaseWheelSpin(p);
      const delay = Math.max(0, Math.round(tNorm * durationMs) - (Date.now() - startWall));
      const id = setTimeout(() => {
        playTick();
      }, delay);
      tickTimersRef.current.push(id);
    }
  };

  // Rotation only while spinning — ready/idle stays parked (no auto-spin visual).
  useEffect(() => {
    clearTickTimers();
    if (phase !== 'spinning') {
      cancelAnimation(spinDeg);
      const land = landRotationForSlot(slot || 1, maxSlots, 0);
      spinDeg.value = land;
      return undefined;
    }

    const endMs = Date.parse(spinEndsAt || '') || Date.now() + 30_000;
    const startMs = Date.parse(spinStartedAt || '') || Date.now();
    const total = Math.max(1, endMs - startMs);
    const remaining = Math.max(180, endMs - Date.now());
    const elapsed = Math.max(0, Math.min(total, Date.now() - startMs));
    const progress = elapsed / total;

    const extra = spinsForDuration(total);
    const finalDeg = landRotationForSlot(targetSlot || slot || 1, maxSlots, extra);
    const fromDeg = easeWheelSpin(progress) * finalDeg;
    spinDeg.value = fromDeg;

    schedulePegTicks(fromDeg, finalDeg, remaining, maxSlots);

    spinDeg.value = withTiming(finalDeg, {
      duration: remaining,
      easing: easeWheelSpin,
    });

    return () => {
      cancelAnimation(spinDeg);
      clearTickTimers();
    };
    // spinDeg is a stable shared value; omit from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, roundId, targetSlot, slot, maxSlots, spinStartedAt, spinEndsAt]);

  // Glow pulse only — never tied to rotation (ready must not look like a spin).
  useEffect(() => {
    if (phase !== 'spinning' && phase !== 'ready') {
      cancelAnimation(pulse);
      pulse.value = 0;
      return undefined;
    }
    const half = phase === 'ready' ? 1600 : 900;
    pulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: half, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: half, easing: Easing.inOut(Easing.sin) })
      ),
      -1,
      false
    );
    return () => cancelAnimation(pulse);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const wheelStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${spinDeg.value}deg` }],
  }));

  const glowStyle = useAnimatedStyle(() => ({
    opacity: 0.35 + pulse.value * 0.35,
    transform: [{ scale: 1 + pulse.value * 0.06 }],
  }));

  return (
    <View style={[styles.wrap, { width: size + 36, height: size + 12 }]}>
      <View style={[styles.wheelStage, { width: size, height: size }]}>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.glow,
            {
              width: size + 10,
              height: size + 10,
              borderRadius: (size + 10) / 2,
            },
            glowStyle,
          ]}
        />
        <Animated.View
          style={[
            {
              width: size,
              height: size,
            },
            wheelStyle,
          ]}
        >
          <Svg width={size} height={size}>
            <Defs>
              <SvgLinearGradient id="hubGold" x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0%" stopColor={GOLD_SOFT} />
                <Stop offset="45%" stopColor={GOLD} />
                <Stop offset="100%" stopColor={GOLD_DARK} />
              </SvgLinearGradient>
              <SvgLinearGradient id="bezelRing" x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0%" stopColor="#141418" />
                <Stop offset="50%" stopColor={INK} />
                <Stop offset="100%" stopColor="#0B2F2C" />
              </SvgLinearGradient>
              <SvgLinearGradient id="rimBrand" x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0%" stopColor={TEAL_LIGHT} />
                <Stop offset="40%" stopColor={TEAL} />
                <Stop offset="75%" stopColor={GOLD} />
                <Stop offset="100%" stopColor={GOLD_DARK} />
              </SvgLinearGradient>
              <SvgLinearGradient id="discTeal" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0%" stopColor="#0E4A44" />
                <Stop offset="100%" stopColor={INK} />
              </SvgLinearGradient>
            </Defs>

            {/* Outer bezel — teal→gold rim on ink (Blyp stage) */}
            <Circle cx={cx} cy={cy} r={rBezel + 2} fill="url(#bezelRing)" stroke="url(#rimBrand)" strokeWidth={4} />
            <Circle cx={cx} cy={cy} r={rOuter + 1.5} fill="url(#discTeal)" stroke={TEAL} strokeWidth={1.75} />

            <G>
              {segments.map((s) => (
                <Path
                  key={s.n}
                  d={s.path}
                  fill={s.color}
                  stroke={s.occupied ? TEAL : s.accent ? 'rgba(245,197,66,0.65)' : 'rgba(0,210,190,0.28)'}
                  strokeWidth={s.occupied ? 1.8 : 1.1}
                />
              ))}
            </G>

            {/* Rim studs — gold empty / teal occupied */}
            {segments.map((s) => (
              <Circle
                key={`stud-${s.n}`}
                cx={s.stud.x}
                cy={s.stud.y}
                r={Math.max(1.8, size * 0.013)}
                fill={s.occupied ? TEAL : GOLD}
                stroke={INK}
                strokeWidth={0.7}
              />
            ))}

            {/* Hub — gold prize core + teal pin */}
            <Circle cx={cx} cy={cy} r={rInner + 3} fill={INK} stroke={GOLD} strokeWidth={2.2} />
            <Circle cx={cx} cy={cy} r={rInner} fill="url(#hubGold)" stroke={INK} strokeWidth={1.5} />
            <Circle cx={cx} cy={cy} r={rInner * 0.4} fill={INK} stroke={TEAL_DIM} strokeWidth={1} />
            <Circle cx={cx} cy={cy} r={rInner * 0.18} fill={TEAL} />
          </Svg>

          <View style={[StyleSheet.absoluteFillObject, { width: size, height: size }]} pointerEvents="none">
            {segments.map((s) => {
              const chip = s.occupied ? faceSize + 2 : Math.max(20, Math.round(size * 0.11));
              const half = chip / 2;
              return (
                <View
                  key={`t-${s.n}`}
                  style={[
                    styles.segLabel,
                    {
                      left: s.labelPos.x - half,
                      top: s.labelPos.y - half,
                      width: chip,
                      height: chip,
                    },
                  ]}
                >
                  {s.occupied ? (
                    <SegFace uri={s.photo} name={s.name} size={faceSize} />
                  ) : (
                    <View style={styles.emptyChip}>
                      <Text style={[styles.segNum, { fontSize: Math.max(10, size * 0.055) }]} allowFontScaling={false}>
                        {s.n}
                      </Text>
                    </View>
                  )}
                </View>
              );
            })}
            <View style={[styles.hubLabel, { left: cx - 26, top: cy - 11, width: 52 }]}>
              <Text style={styles.hubText} allowFontScaling={false}>
                {phase === 'ready' ? 'READY' : phase === 'spinning' ? 'SPIN' : 'FE'}
              </Text>
            </View>
          </View>
        </Animated.View>
      </View>

      <View style={[styles.pointerWrap, { height: size }]} pointerEvents="none">
        <View style={styles.pointerStem} />
        <View style={styles.pointer} />
        <View style={styles.pointerCore} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    paddingRight: 4,
  },
  pointerWrap: {
    width: 28,
    marginLeft: -8,
    zIndex: 6,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  pointerStem: {
    position: 'absolute',
    left: 0,
    width: 10,
    height: 6,
    backgroundColor: GOLD_DARK,
    borderRadius: 2,
  },
  pointer: {
    width: 0,
    height: 0,
    marginLeft: 6,
    borderTopWidth: 12,
    borderBottomWidth: 12,
    borderRightWidth: 22,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderRightColor: GOLD,
    shadowColor: TEAL,
    shadowOpacity: 0.55,
    shadowRadius: 5,
    shadowOffset: { width: -1, height: 0 },
  },
  pointerCore: {
    position: 'absolute',
    left: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: TEAL,
    borderWidth: 1,
    borderColor: INK,
  },
  wheelStage: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
    backgroundColor: 'rgba(0,210,190,0.28)',
    borderWidth: 1.5,
    borderColor: 'rgba(245,197,66,0.45)',
  },
  segLabel: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyChip: {
    minWidth: 20,
    minHeight: 20,
    paddingHorizontal: 3,
    borderRadius: 8,
    backgroundColor: 'rgba(10,10,12,0.7)',
    borderWidth: 1,
    borderColor: 'rgba(0,210,190,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  segNum: {
    color: TEAL_LIGHT,
    fontWeight: '900',
    letterSpacing: 0.3,
    textShadowColor: 'rgba(0,0,0,0.65)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  hubLabel: {
    position: 'absolute',
    alignItems: 'center',
  },
  hubText: {
    color: INK,
    fontWeight: '900',
    fontSize: 10,
    letterSpacing: 1.4,
  },
});
