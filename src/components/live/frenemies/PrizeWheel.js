/**
 * Frenemies prize wheel — 11 segments, right-side pointer, ease-out land
 * on the authoritative server slot (targetSlot / landedSlot).
 * Occupied slots paint guest photo (else initials) when roster is known.
 * Idle (ready) never rotates — only a soft outer glow pulse.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, Easing, Image } from 'react-native';
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

const TEAL_DEEP = '#0A6B62';
const TEAL = '#00D2BE';
const GOLD = '#F5C542';
const GOLD_SOFT = '#FDE68A';
const GOLD_DARK = '#C9A227';
const INK = '#0A0A0C';
const ROSE = '#FB7185';
const ROSE_DEEP = '#9F1239';

/** Pointer sits at 3 o'clock (degrees from top, clockwise). */
const POINTER_DEG = 90;

const SEG_COLORS = [
  '#0B2F2C',
  '#123F3A',
  '#0E4A44',
  '#1A2A38',
  '#0B2F2C',
  '#163D36',
  '#0E4A44',
  '#1A2530',
  '#0B2F2C',
  '#123F3A',
  '#0E4A44',
];

const SEG_COLORS_ALT = [
  '#0F3D38',
  '#15524A',
  '#0A6B62',
  '#1C3340',
  '#0F3D38',
  '#1A4A40',
  '#0A6B62',
  '#243040',
  '#0F3D38',
  '#15524A',
  '#0A6B62',
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

function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

function spinsForDuration(ms) {
  const s = Math.max(0, ms) / 1000;
  if (s <= 8) return 4;
  if (s <= 20) return 6;
  if (s <= 40) return 9;
  return 12;
}

function segUnderPointer(rotationDeg, maxSlots) {
  const n = Math.max(1, maxSlots);
  const seg = 360 / n;
  const under = ((POINTER_DEG - rotationDeg) % 360 + 360) % 360;
  return Math.floor(under / seg) % n;
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
  const spinAnim = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const tickSoundRef = useRef(null);
  const lastTickSeg = useRef(-1);
  const tickBusy = useRef(false);

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
        color: occupied ? TEAL_DEEP : i % 2 === 0 ? SEG_COLORS[i % SEG_COLORS.length] : SEG_COLORS_ALT[i % SEG_COLORS_ALT.length],
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
    (async () => {
      try {
        const { sound } = await Audio.Sound.createAsync(WHEEL_TICK, {
          shouldPlay: false,
          volume: 0.25,
          isLooping: false,
        });
        if (cancelled) {
          await sound.unloadAsync().catch(() => {});
          return;
        }
        tickSoundRef.current = sound;
      } catch {
        // Best-effort — wheel still works silent.
      }
    })();
    return () => {
      cancelled = true;
      const s = tickSoundRef.current;
      tickSoundRef.current = null;
      if (s) s.unloadAsync().catch(() => {});
    };
  }, []);

  const playTick = () => {
    const s = tickSoundRef.current;
    if (!s || tickBusy.current) return;
    tickBusy.current = true;
    s.replayAsync()
      .catch(() => s.setPositionAsync(0).then(() => s.playAsync()).catch(() => {}))
      .finally(() => {
        setTimeout(() => {
          tickBusy.current = false;
        }, 28);
      });
  };

  // Rotation only while spinning — ready/idle stays parked (no auto-spin visual).
  useEffect(() => {
    if (phase !== 'spinning') {
      const land = landRotationForSlot(slot || 1, maxSlots, 0);
      spinAnim.setValue(land);
      lastTickSeg.current = -1;
      return undefined;
    }

    const endMs = Date.parse(spinEndsAt || '') || Date.now() + 30_000;
    const startMs = Date.parse(spinStartedAt || '') || Date.now();
    const total = Math.max(1, endMs - startMs);
    const remaining = Math.max(120, endMs - Date.now());
    const elapsed = Math.max(0, Math.min(total, Date.now() - startMs));
    const progress = elapsed / total;

    const extra = spinsForDuration(total);
    const finalDeg = landRotationForSlot(targetSlot || slot || 1, maxSlots, extra);
    const fromDeg = easeOutCubic(progress) * finalDeg;
    spinAnim.setValue(fromDeg);
    lastTickSeg.current = segUnderPointer(fromDeg, maxSlots);

    const id = spinAnim.addListener(({ value }) => {
      const idx = segUnderPointer(value, maxSlots);
      if (idx !== lastTickSeg.current) {
        lastTickSeg.current = idx;
        playTick();
      }
    });

    const anim = Animated.timing(spinAnim, {
      toValue: finalDeg,
      duration: remaining,
      easing: Easing.bezier(0.12, 0.75, 0.18, 1),
      useNativeDriver: true,
    });
    anim.start();

    return () => {
      anim.stop();
      spinAnim.removeListener(id);
    };
  }, [phase, roundId, targetSlot, slot, maxSlots, spinStartedAt, spinEndsAt, spinAnim]);

  // Glow pulse only — never tied to rotation (ready must not look like a spin).
  useEffect(() => {
    if (phase !== 'spinning' && phase !== 'ready') {
      pulse.setValue(0);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: phase === 'ready' ? 1600 : 900,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: phase === 'ready' ? 1600 : 900,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [phase, pulse]);

  const rotate = spinAnim.interpolate({
    inputRange: [-7200, 7200],
    outputRange: ['-7200deg', '7200deg'],
  });

  const glowScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });
  const glowOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.7] });

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
              opacity: glowOpacity,
              transform: [{ scale: glowScale }],
            },
          ]}
        />
        <Animated.View
          style={{
            width: size,
            height: size,
            transform: [{ rotate }],
          }}
        >
          <Svg width={size} height={size}>
            <Defs>
              <SvgLinearGradient id="hubGold" x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0%" stopColor={GOLD_SOFT} />
                <Stop offset="45%" stopColor={GOLD} />
                <Stop offset="100%" stopColor={GOLD_DARK} />
              </SvgLinearGradient>
              <SvgLinearGradient id="bezelRing" x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0%" stopColor="#2A2418" />
                <Stop offset="50%" stopColor={INK} />
                <Stop offset="100%" stopColor="#1A1520" />
              </SvgLinearGradient>
              <SvgLinearGradient id="rimGold" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0%" stopColor={GOLD_SOFT} />
                <Stop offset="100%" stopColor={GOLD_DARK} />
              </SvgLinearGradient>
            </Defs>

            {/* Outer bezel */}
            <Circle cx={cx} cy={cy} r={rBezel + 2} fill="url(#bezelRing)" stroke="url(#rimGold)" strokeWidth={3.5} />
            <Circle cx={cx} cy={cy} r={rOuter + 1.5} fill={INK} stroke="rgba(0,210,190,0.45)" strokeWidth={1.5} />

            <G>
              {segments.map((s) => (
                <Path
                  key={s.n}
                  d={s.path}
                  fill={s.color}
                  stroke={s.occupied ? TEAL : s.accent ? 'rgba(245,197,66,0.55)' : 'rgba(245,197,66,0.28)'}
                  strokeWidth={s.occupied ? 1.6 : 1}
                />
              ))}
            </G>

            {/* Gold studs on bezel */}
            {segments.map((s) => (
              <Circle
                key={`stud-${s.n}`}
                cx={s.stud.x}
                cy={s.stud.y}
                r={Math.max(1.6, size * 0.012)}
                fill={s.occupied ? TEAL : GOLD}
                stroke={INK}
                strokeWidth={0.6}
              />
            ))}

            {/* Hub */}
            <Circle cx={cx} cy={cy} r={rInner + 3} fill={INK} stroke={GOLD} strokeWidth={2} />
            <Circle cx={cx} cy={cy} r={rInner} fill="url(#hubGold)" stroke={INK} strokeWidth={1.5} />
            <Circle cx={cx} cy={cy} r={rInner * 0.38} fill={INK} />
            <Circle cx={cx} cy={cy} r={rInner * 0.18} fill={GOLD} />
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
    borderRightColor: ROSE,
    shadowColor: ROSE_DEEP,
    shadowOpacity: 0.55,
    shadowRadius: 4,
    shadowOffset: { width: -1, height: 0 },
  },
  pointerCore: {
    position: 'absolute',
    left: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: GOLD,
    borderWidth: 1,
    borderColor: INK,
  },
  wheelStage: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
    backgroundColor: 'rgba(0,210,190,0.22)',
    borderWidth: 1.5,
    borderColor: 'rgba(245,197,66,0.4)',
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
    backgroundColor: 'rgba(10,10,12,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(245,197,66,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  segNum: {
    color: GOLD_SOFT,
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
