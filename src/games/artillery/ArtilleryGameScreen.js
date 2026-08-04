import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  PanResponder,
  Dimensions,
  Animated,
  ScrollView,
} from 'react-native';
import Icon from '../../components/Icon';
import ArtilleryStage from './ArtilleryStage';
import {
  WORLD,
  WEAPONS,
  WEAPON_ORDER,
  createMatch,
  aimArc,
  simulateShot,
  applyOutcome,
  reviveUnit,
  surfaceAt,
  UNIT_RADIUS,
} from './engine';

const TEAL = '#00D2BE';
const ROSE = '#FB7185';
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

const TEAM_COLORS = ['#00D2BE', '#FB7185'];
const DEBRIS_COLORS = ['#FDBA74', '#FB923C', '#FCD34D', '#F87171', '#FFFFFF'];

// Random shrapnel for an explosion: upward-biased angle, varied speed/size.
function makeDebris() {
  const arr = [];
  for (let k = 0; k < 11; k += 1) {
    arr.push({
      a: Math.PI * 0.12 + Math.random() * Math.PI * 0.76,
      s: 0.55 + Math.random() * 0.95,
      dir: Math.random() < 0.5 ? -1 : 1,
      size: 2 + Math.random() * 3.5,
      color: DEBRIS_COLORS[k % DEBRIS_COLORS.length],
    });
  }
  return arr;
}

export default function ArtilleryGameScreen({ navigation }) {
  const [match, setMatch] = useState(() => createMatch({ unitsPerTeam: 3 }));
  const [angle, setAngle] = useState(45);
  const [power, setPower] = useState(0.62);
  const [weaponId, setWeaponId] = useState('bazooka');
  const [selectedUnitId, setSelectedUnitId] = useState(null);
  const [projectiles, setProjectiles] = useState(null);
  const [trails, setTrails] = useState(null);
  const [explosion, setExplosion] = useState(null);
  const [animating, setAnimating] = useState(false);
  const [stage, setStage] = useState({ w: SCREEN_W, h: Math.round(SCREEN_H * 0.56) });
  const animTimer = useRef(null);
  const shake = useRef(new Animated.Value(0)).current;
  const triggerShake = useCallback(
    (intensity = 1) => {
      shake.setValue(0);
      Animated.sequence([
        Animated.timing(shake, { toValue: intensity, duration: 40, useNativeDriver: true }),
        Animated.timing(shake, { toValue: -intensity, duration: 60, useNativeDriver: true }),
        Animated.timing(shake, { toValue: intensity * 0.5, duration: 50, useNativeDriver: true }),
        Animated.timing(shake, { toValue: 0, duration: 60, useNativeDriver: true }),
      ]).start();
    },
    [shake]
  );
  const shakeStyle = {
    transform: [
      { translateX: shake.interpolate({ inputRange: [-1, 1], outputRange: [-9, 9] }) },
      { translateY: shake.interpolate({ inputRange: [-1, 1], outputRange: [-6, 6] }) },
    ],
  };

  // Active team's alive units; keep a valid selection as turns change.
  const teamUnits = useMemo(
    () => match.units.filter((u) => u.alive && u.team === match.turnTeam),
    [match.units, match.turnTeam]
  );
  const activeUnit = useMemo(
    () => teamUnits.find((u) => u.id === selectedUnitId) || teamUnits[0] || null,
    [teamUnits, selectedUnitId]
  );
  useEffect(() => {
    if (teamUnits[0] && !teamUnits.some((u) => u.id === selectedUnitId)) {
      setSelectedUnitId(teamUnits[0].id);
    }
  }, [teamUnits, selectedUnitId]);

  useEffect(() => () => animTimer.current && clearTimeout(animTimer.current), []);

  // World -> stage pixel mapping.
  const sx = useCallback((x) => (x / WORLD.width) * stage.w, [stage.w]);
  const sy = useCallback((y) => (y / WORLD.height) * stage.h, [stage.h]);

  // Live aim guide: a short predicted arc that updates as the player aims.
  const preview = useMemo(() => {
    if (animating || !activeUnit || match.status === 'ended') return null;
    const arc = aimArc(match, { unitId: activeUnit.id, weaponId, angleDeg: angle, power });
    return arc ? arc.slice(0, 18) : null;
  }, [animating, activeUnit, match, weaponId, angle, power]);

  // Drag-to-aim: dragging the battlefield aims from the active unit
  // (direction = angle, distance = power). Sliders still fine-tune.
  const aimRef = useRef({ unit: null, terrain: null, w: 1, h: 1 });
  aimRef.current = { unit: activeUnit, terrain: match.terrain, w: stage.w, h: stage.h };
  const applyAim = (e) => {
    const { unit, terrain, w, h } = aimRef.current;
    if (!unit || !w || !h) return;
    const wx = (e.nativeEvent.locationX / w) * WORLD.width;
    const wy = (e.nativeEvent.locationY / h) * WORLD.height;
    const uy = surfaceAt(terrain, unit.x) - UNIT_RADIUS;
    const dx = wx - unit.x;
    const dy = uy - wy;
    const ang = (Math.atan2(Math.max(dy, 1), Math.abs(dx)) * 180) / Math.PI;
    setAngle(clampNum(ang, 5, 85));
    setPower(clampNum(Math.hypot(dx, dy) / 420, 0.05, 1));
  };
  const applyAimRef = useRef(applyAim);
  applyAimRef.current = applyAim;
  const stagePan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => applyAimRef.current(e),
      onPanResponderMove: (e) => applyAimRef.current(e),
    })
  ).current;

  const fire = useCallback(() => {
    if (animating || match.status === 'ended' || !activeUnit) return;
    const outcome = simulateShot(match, {
      unitId: activeUnit.id,
      weaponId,
      angleDeg: angle,
      power,
    });
    if (!outcome) return;
    setAnimating(true);
    const trajs = outcome.trajectories;
    const maxLen = Math.max(...trajs.map((t) => t.length));
    let i = 0;
    const step = () => {
      setProjectiles(trajs.map((t) => t[Math.min(i, t.length - 1)]));
      setTrails(trajs.map((t) => t.slice(0, Math.min(i + 1, t.length))));
      i += 2;
      if (i < maxLen) {
        animTimer.current = setTimeout(step, 16);
      } else {
        setProjectiles(null);
        setTrails(null);
        if (!outcome.blasts || outcome.blasts.length === 0) {
          setMatch((m) => applyOutcome(m, outcome));
          setAnimating(false);
          return;
        }
        const blasts = outcome.blasts.map((b) => ({ x: b.x, y: b.y, r: b.crater, debris: makeDebris() }));
        const maxCrater = Math.max(...blasts.map((b) => b.r));
        triggerShake(Math.min(1, maxCrater / 60));
        let t = 0;
        const boom = () => {
          t += 1 / 16;
          setExplosion({ blasts, t: Math.min(t, 1) });
          if (t < 1) {
            animTimer.current = setTimeout(boom, 16);
          } else {
            setExplosion(null);
            setMatch((m) => applyOutcome(m, outcome));
            setAnimating(false);
          }
        };
        boom();
      }
    };
    step();
  }, [animating, match, activeUnit, weaponId, angle, power, triggerShake]);

  const doRevive = useCallback(
    (team) => {
      if (animating) return;
      setMatch((m) => reviveUnit(m, team));
    },
    [animating]
  );

  const nextUnit = useCallback(() => {
    if (animating || teamUnits.length < 2) return;
    const idx = teamUnits.findIndex((u) => u.id === activeUnit?.id);
    setSelectedUnitId(teamUnits[(idx + 1) % teamUnits.length].id);
  }, [animating, teamUnits, activeUnit]);

  const restart = useCallback(() => {
    setMatch(createMatch({ unitsPerTeam: 3 }));
    setAnimating(false);
    setProjectiles(null);
    setTrails(null);
    setExplosion(null);
  }, []);


  const livesByTeam = [0, 1].map((t) => match.units.filter((u) => u.alive && u.team === t).length);
  const turnColor = TEAM_COLORS[match.turnTeam];

  // Aim arrow from the active unit.
  const aimArrow = useMemo(() => {
    if (!activeUnit) return null;
    const ux = sx(activeUnit.x);
    const uy = sy(surfaceAt(match.terrain, activeUnit.x)) - UNIT_RADIUS * (stage.h / WORLD.height) - 6;
    const dir = activeUnit.team === 0 ? 1 : -1;
    const len = 30 + power * 60;
    const rad = (angle * Math.PI) / 180;
    return {
      x1: ux,
      y1: uy,
      x2: ux + Math.cos(rad) * len * dir,
      y2: uy - Math.sin(rad) * len,
    };
  }, [activeUnit, match.terrain, angle, power, sx, sy, stage.h]);

  return (
    <View style={styles.root}>
      {/* Top HUD */}
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => navigation?.goBack?.()}>
          <Icon name="close" size={22} color="#fff" />
        </TouchableOpacity>
        <View style={styles.turnPill}>
          <View style={[styles.turnDot, { backgroundColor: turnColor }]} />
          <Text style={styles.turnText} allowFontScaling={false}>
            {match.status === 'ended'
              ? match.winner === -1
                ? 'Draw'
                : match.teamNames[match.winner] === 'You'
                  ? 'You win!'
                  : `${match.teamNames[match.winner]} wins!`
              : match.teamNames[match.turnTeam] === 'You'
                ? 'Your turn'
                : `${match.teamNames[match.turnTeam]}'s turn`}
          </Text>
        </View>
        <View style={styles.windPill}>
          <Icon name="navigate" size={14} color="#A1A1AA" />
          <Text style={styles.windText} allowFontScaling={false}>
            {match.wind === 0 ? 'Calm' : `${match.wind > 0 ? '→' : '←'} ${Math.abs(match.wind)}`}
          </Text>
        </View>
      </View>

      {/* Lives */}
      <View style={styles.livesRow}>
        {[0, 1].map((t) => (
          <View key={t} style={styles.livesGroup}>
            <Text style={[styles.livesName, { color: TEAM_COLORS[t] }]} allowFontScaling={false}>
              {match.teamNames[t]}
            </Text>
            {Array.from({ length: Math.max(livesByTeam[t], 0) }).map((_, i) => (
              <View key={i} style={[styles.lifeDot, { backgroundColor: TEAM_COLORS[t] }]} />
            ))}
            <TouchableOpacity style={styles.reviveBtn} onPress={() => doRevive(t)}>
              <Icon name="add" size={14} color="#0A0A0C" />
            </TouchableOpacity>
          </View>
        ))}
      </View>

      {/* Game stage */}
      <Animated.View
        style={[styles.stage, shakeStyle]}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          if (width && height) setStage({ w: width, h: height });
        }}
        {...stagePan.panHandlers}
      >
        <ArtilleryStage
          state={match}
          width={stage.w}
          height={stage.h}
          activeUnitId={activeUnit?.id ?? null}
          aimArrow={aimArrow && !animating && match.status !== 'ended' ? aimArrow : null}
          preview={!animating ? preview : null}
          trails={trails}
          projectiles={projectiles}
          explosion={explosion}
        />
      </Animated.View>

      {/* Controls */}
      <View style={styles.controls}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.weaponRow}
        >
          {WEAPON_ORDER.map((id) => {
            const w = WEAPONS[id];
            const active = id === weaponId;
            return (
              <TouchableOpacity
                key={id}
                style={[styles.weaponBtn, active && styles.weaponBtnActive]}
                onPress={() => setWeaponId(id)}
              >
                <Icon name={w.icon} size={18} color={active ? '#0A0A0C' : '#fff'} />
                <Text style={[styles.weaponText, active && styles.weaponTextActive]} allowFontScaling={false}>
                  {w.name}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <Slider label={`Angle ${Math.round(angle)}\u00b0`} value={(angle - 5) / 80} onChange={(v) => setAngle(5 + v * 80)} />
        <Slider label={`Power ${Math.round(power * 100)}%`} value={power} onChange={setPower} accent />

        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.smallBtn} onPress={nextUnit}>
            <Icon name="people" size={18} color="#fff" />
            <Text style={styles.smallBtnText} allowFontScaling={false}>Next</Text>
          </TouchableOpacity>

          {match.status === 'ended' ? (
            <TouchableOpacity style={[styles.fireBtn, styles.againBtn]} onPress={restart}>
              <Text style={styles.fireText} allowFontScaling={false}>Play again</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.fireBtn, animating && styles.fireBtnDisabled]}
              onPress={fire}
              disabled={animating}
            >
              <Icon name="flame" size={20} color="#0A0A0C" />
              <Text style={styles.fireText} allowFontScaling={false}>FIRE</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.smallBtn} onPress={restart}>
            <Icon name="refresh" size={18} color="#fff" />
            <Text style={styles.smallBtnText} allowFontScaling={false}>Reset</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

function clampNum(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Minimal themed slider (track + thumb) driven by PanResponder. */
function Slider({ label, value, onChange, accent }) {
  const [w, setW] = useState(1);
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        const x = e.nativeEvent.locationX;
        onChange(clampNum(x / w, 0, 1));
      },
      onPanResponderMove: (e) => {
        const x = e.nativeEvent.locationX;
        onChange(clampNum(x / w, 0, 1));
      },
    })
  ).current;
  return (
    <View style={styles.sliderWrap}>
      <Text style={styles.sliderLabel} allowFontScaling={false}>{label}</Text>
      <View
        style={styles.sliderTrack}
        onLayout={(e) => setW(e.nativeEvent.layout.width || 1)}
        {...pan.panHandlers}
      >
        <View style={[styles.sliderFill, { width: `${clampNum(value, 0, 1) * 100}%`, backgroundColor: accent ? ROSE : TEAL }]} />
        <View style={[styles.sliderThumb, { left: `${clampNum(value, 0, 1) * 100}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0A0A0C' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 44,
    paddingBottom: 8,
    gap: 10,
  },
  iconBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  turnPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 8,
  },
  turnDot: { width: 8, height: 8, borderRadius: 4 },
  turnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  windPill: { flexDirection: 'row', alignItems: 'center', gap: 5, marginLeft: 'auto' },
  windText: { color: '#A1A1AA', fontWeight: '600', fontSize: 13 },
  livesRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 6 },
  livesGroup: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  livesName: { fontWeight: '800', fontSize: 12, marginRight: 4 },
  lifeDot: { width: 10, height: 10, borderRadius: 5 },
  reviveBtn: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: TEAL,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
  },
  stage: { width: '100%', flex: 1, overflow: 'hidden' },
  controls: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 24, gap: 10 },
  weaponRow: { flexDirection: 'row', gap: 8, paddingRight: 8 },
  weaponBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  weaponBtnActive: { backgroundColor: TEAL, borderColor: TEAL },
  weaponText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  weaponTextActive: { color: '#0A0A0C' },
  sliderWrap: { gap: 5 },
  sliderLabel: { color: '#A1A1AA', fontWeight: '600', fontSize: 12 },
  sliderTrack: {
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center',
  },
  sliderFill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 12 },
  sliderThumb: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#fff',
    marginLeft: -11,
    top: 1,
  },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 2 },
  smallBtn: { alignItems: 'center', justifyContent: 'center', width: 56, gap: 2 },
  smallBtnText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  fireBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 54,
    borderRadius: 27,
    backgroundColor: TEAL,
  },
  againBtn: { backgroundColor: '#fff' },
  fireBtnDisabled: { opacity: 0.5 },
  fireText: { color: '#0A0A0C', fontWeight: '800', fontSize: 17 },
});
