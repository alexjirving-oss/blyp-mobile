import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, PanResponder, Animated, ScrollView } from 'react-native';
import Icon from '../../components/Icon';
import ArtilleryStage from './ArtilleryStage';
import { WORLD, WEAPONS, WEAPON_ORDER, aimArc, surfaceAt, UNIT_RADIUS } from './engine';
import { subscribeToGameEvents } from '../../realtime/artilleryGameSocket';
import { artilleryStart, artilleryJoin, artilleryFire, artilleryGetState } from '../../api/ivsLiveApi';

const TEAL = '#00D2BE';
const ROSE = '#FB7185';
const TEAM_COLORS = ['#00D2BE', '#FB7185'];
const DEBRIS_COLORS = ['#FDBA74', '#FB923C', '#FCD34D', '#F87171', '#FFFFFF'];

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

function clampNum(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * NetworkedArtillery — the server-authoritative battle-stage game surface.
 *
 * Renders the authoritative match state pushed over the `game_event` socket and
 * sends fire intents over REST. Controls are only enabled for the player whose
 * turn it is; everyone else (the other creator off-turn, and all viewers) sees a
 * live, read-only view. Revives arrive as STATE events (driven by revive gifts).
 *
 * Props:
 *  - sessionId: live session id (== realtime room id)
 *  - battleId:  optional battle id this match belongs to
 *  - role:      'creator' (team 0) | 'opponent' (team 1) | 'spectator'
 *  - creatorName / opponentName: display names for the HUD
 *  - onClose:   optional close handler (standalone use)
 */
export default function NetworkedArtillery({
  sessionId,
  battleId = null,
  role = 'spectator',
  creatorName,
  opponentName,
  onClose,
}) {
  const myTeam = role === 'creator' ? 0 : role === 'opponent' ? 1 : -1;

  const [room, setRoom] = useState(null); // latest authoritative {version, players, state, battleId}
  const [displayState, setDisplayState] = useState(null); // what's drawn (may lag during a shot)
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [status, setStatus] = useState('Connecting…');

  const [weaponId, setWeaponId] = useState('bazooka');
  const [angle, setAngle] = useState(45);
  const [power, setPower] = useState(0.62);
  const [selectedUnitId, setSelectedUnitId] = useState(null);

  const [projectiles, setProjectiles] = useState(null);
  const [trails, setTrails] = useState(null);
  const [explosion, setExplosion] = useState(null);
  const [animating, setAnimating] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const animTimer = useRef(null);
  const animatingRef = useRef(false);
  const roomRef = useRef(null);
  const joinedRef = useRef(false);
  const shake = useRef(new Animated.Value(0)).current;

  animatingRef.current = animating;
  roomRef.current = room;

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

  // Keep a ref of the displayed (pre-shot) state so the animator can read it.
  const displayStateRef = useRef(null);
  displayStateRef.current = displayState;

  // Animate a server-sent shot outcome, then reconcile to the latest state.
  const playOutcome = useCallback(
    (outcome) => {
      if (!outcome || !outcome.trajectories || !displayStateRef.current) {
        setDisplayState(roomRef.current?.state ?? null);
        return;
      }
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
            setDisplayState(roomRef.current?.state ?? null);
            setAnimating(false);
            return;
          }
          const blasts = outcome.blasts.map((b) => ({ x: b.x, y: b.y, r: b.crater, debris: makeDebris() }));
          triggerShake(Math.min(1, Math.max(...blasts.map((b) => b.r)) / 60));
          let t = 0;
          const boom = () => {
            t += 1 / 16;
            setExplosion({ blasts, t: Math.min(t, 1) });
            if (t < 1) {
              animTimer.current = setTimeout(boom, 16);
            } else {
              setExplosion(null);
              setDisplayState(roomRef.current?.state ?? null);
              setAnimating(false);
            }
          };
          boom();
        }
      };
      step();
    },
    [triggerShake]
  );

  // Apply an incoming event (also used for the initial REST snapshot).
  const applyEvent = useCallback(
    (evt) => {
      if (!evt || !evt.state) return;
      const newRoom = { version: evt.version, players: evt.players, state: evt.state, battleId: evt.battleId };
      setRoom(newRoom);
      roomRef.current = newRoom; // sync so the animator reconciles to the latest
      setStatus('');
      // Opponent auto-registers as team 1 once a match exists.
      if (role === 'opponent' && !joinedRef.current && (!evt.players || !evt.players['1'])) {
        joinedRef.current = true;
        artilleryJoin(sessionId).catch(() => {
          joinedRef.current = false;
        });
      }
      if (evt.type === 'SHOT' && evt.outcome) {
        setSubmitting(false);
        if (displayStateRef.current && !animatingRef.current) {
          playOutcome(evt.outcome);
        } else {
          setDisplayState(evt.state);
        }
      } else {
        // STATE (start/join/revive). Apply immediately unless mid-animation.
        if (!animatingRef.current) setDisplayState(evt.state);
      }
    },
    [role, sessionId, playOutcome]
  );

  useEffect(() => {
    if (!sessionId) return undefined;
    let sub = null;
    let cancelled = false;
    (async () => {
      try {
        sub = await subscribeToGameEvents(sessionId, (evt) => {
          if (!cancelled) applyEvent(evt);
        });
      } catch {
        // socket optional; REST snapshot + later reconnect still work
      }
      try {
        const snap = await artilleryGetState(sessionId);
        if (!cancelled) applyEvent(snap);
      } catch {
        // No match yet. The creator opens it; others wait for the first STATE.
        if (!cancelled && role === 'creator') {
          try {
            const started = await artilleryStart(sessionId, battleId || undefined, { creatorName, opponentName });
            if (!cancelled) applyEvent(started);
          } catch {
            if (!cancelled) setStatus('Could not start the match.');
          }
        } else if (!cancelled) {
          setStatus('Waiting for the match to start…');
        }
      }
    })();
    return () => {
      cancelled = true;
      if (sub) sub.close();
      if (animTimer.current) clearTimeout(animTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Derived: my alive units and the currently selected one.
  const myUnits = useMemo(() => {
    if (!displayState || myTeam < 0) return [];
    return displayState.units.filter((u) => u.alive && u.team === myTeam);
  }, [displayState, myTeam]);

  const activeUnit = useMemo(() => {
    if (myUnits.length === 0) return null;
    return myUnits.find((u) => u.id === selectedUnitId) || myUnits[0];
  }, [myUnits, selectedUnitId]);

  useEffect(() => {
    if (myUnits[0] && !myUnits.some((u) => u.id === selectedUnitId)) {
      setSelectedUnitId(myUnits[0].id);
    }
  }, [myUnits, selectedUnitId]);

  const isMyTurn =
    !!displayState &&
    displayState.status === 'playing' &&
    myTeam >= 0 &&
    displayState.turnTeam === myTeam;
  const canControl = isMyTurn && !animating && !submitting && !!activeUnit;

  const sx = useCallback((x) => (x / WORLD.width) * stage.w, [stage.w]);
  const sy = useCallback((y) => (y / WORLD.height) * stage.h, [stage.h]);

  const preview = useMemo(() => {
    if (!canControl || !activeUnit || !displayState) return null;
    const arc = aimArc(displayState, { unitId: activeUnit.id, weaponId, angleDeg: angle, power });
    return arc ? arc.slice(0, 18) : null;
  }, [canControl, activeUnit, displayState, weaponId, angle, power]);

  const aimArrow = useMemo(() => {
    if (!canControl || !activeUnit || !displayState || stage.h === 0) return null;
    const ux = sx(activeUnit.x);
    const uy = sy(surfaceAt(displayState.terrain, activeUnit.x)) - UNIT_RADIUS * (stage.h / WORLD.height) - 6;
    const dir = activeUnit.team === 0 ? 1 : -1;
    const len = 30 + power * 60;
    const rad = (angle * Math.PI) / 180;
    return { x1: ux, y1: uy, x2: ux + Math.cos(rad) * len * dir, y2: uy - Math.sin(rad) * len };
  }, [canControl, activeUnit, displayState, angle, power, sx, sy, stage.h]);

  // Drag-to-aim (only matters when it's our turn).
  const aimRef = useRef({ unit: null, terrain: null, w: 1, h: 1 });
  aimRef.current = { unit: activeUnit, terrain: displayState?.terrain, w: stage.w, h: stage.h };
  const applyAim = (e) => {
    const { unit, terrain, w, h } = aimRef.current;
    if (!unit || !terrain || !w || !h) return;
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
  const canControlRef = useRef(canControl);
  canControlRef.current = canControl;
  const stagePan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => canControlRef.current,
      onMoveShouldSetPanResponder: () => canControlRef.current,
      onPanResponderGrant: (e) => applyAimRef.current(e),
      onPanResponderMove: (e) => applyAimRef.current(e),
    })
  ).current;

  const nextUnit = useCallback(() => {
    if (!canControl || myUnits.length < 2) return;
    const idx = myUnits.findIndex((u) => u.id === activeUnit?.id);
    setSelectedUnitId(myUnits[(idx + 1) % myUnits.length].id);
  }, [canControl, myUnits, activeUnit]);

  const fire = useCallback(async () => {
    if (!canControl || !activeUnit) return;
    setSubmitting(true);
    try {
      await artilleryFire(sessionId, { unitId: activeUnit.id, weaponId, angleDeg: angle, power });
      // The authoritative SHOT broadcast drives the animation for everyone.
    } catch (e) {
      setSubmitting(false);
      setStatus('Shot rejected — try again.');
      setTimeout(() => setStatus(''), 1500);
    }
  }, [canControl, activeUnit, sessionId, weaponId, angle, power]);

  const st = displayState;
  const turnColor = st ? TEAM_COLORS[st.turnTeam] : TEAL;
  const livesByTeam = st ? [0, 1].map((t) => st.units.filter((u) => u.alive && u.team === t).length) : [0, 0];

  const turnLabel = useMemo(() => {
    if (!st) return status || 'Loading…';
    if (st.status === 'ended') {
      if (st.winner === -1) return 'Draw';
      return myTeam === st.winner ? 'You win!' : `${st.teamNames[st.winner]} wins!`;
    }
    if (myTeam < 0) return `${st.teamNames[st.turnTeam]}'s turn`;
    return st.turnTeam === myTeam ? 'Your turn' : `${st.teamNames[st.turnTeam]}'s turn`;
  }, [st, myTeam, status]);

  return (
    <View style={styles.root}>
      <View style={styles.topBar}>
        {onClose ? (
          <TouchableOpacity style={styles.iconBtn} onPress={onClose}>
            <Icon name="close" size={22} color="#fff" />
          </TouchableOpacity>
        ) : (
          <View style={styles.iconBtn} />
        )}
        <View style={styles.turnPill}>
          <View style={[styles.turnDot, { backgroundColor: turnColor }]} />
          <Text style={styles.turnText} allowFontScaling={false}>{turnLabel}</Text>
        </View>
        <View style={styles.windPill}>
          <Icon name="navigate" size={14} color="#A1A1AA" />
          <Text style={styles.windText} allowFontScaling={false}>
            {st ? (st.wind === 0 ? 'Calm' : `${st.wind > 0 ? '→' : '←'} ${Math.abs(st.wind)}`) : '—'}
          </Text>
        </View>
      </View>

      {st ? (
        <View style={styles.livesRow}>
          {[0, 1].map((t) => (
            <View key={t} style={styles.livesGroup}>
              <Text style={[styles.livesName, { color: TEAM_COLORS[t] }]} allowFontScaling={false}>
                {st.teamNames[t]}
              </Text>
              {Array.from({ length: Math.max(livesByTeam[t], 0) }).map((_, i) => (
                <View key={i} style={[styles.lifeDot, { backgroundColor: TEAM_COLORS[t] }]} />
              ))}
            </View>
          ))}
        </View>
      ) : null}

      <Animated.View
        style={[styles.stage, shakeStyle]}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          if (width && height) setStage({ w: width, h: height });
        }}
        {...stagePan.panHandlers}
      >
        {st && stage.w > 0 ? (
          <ArtilleryStage
            state={st}
            width={stage.w}
            height={stage.h}
            activeUnitId={canControl ? activeUnit?.id ?? null : null}
            aimArrow={aimArrow}
            preview={preview}
            trails={trails}
            projectiles={projectiles}
            explosion={explosion}
          />
        ) : (
          <View style={styles.loadingWrap}>
            <Text style={styles.loadingText} allowFontScaling={false}>{status || 'Loading…'}</Text>
          </View>
        )}
      </Animated.View>

      {/* Controls only for the current-turn player; everyone else watches. */}
      {myTeam >= 0 ? (
        <View style={styles.controls}>
          {!isMyTurn && st && st.status === 'playing' ? (
            <Text style={styles.waitText} allowFontScaling={false}>
              Waiting for {st.teamNames[st.turnTeam]}…
            </Text>
          ) : null}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.weaponRow}>
            {WEAPON_ORDER.map((id) => {
              const w = WEAPONS[id];
              const active = id === weaponId;
              return (
                <TouchableOpacity
                  key={id}
                  style={[styles.weaponBtn, active && styles.weaponBtnActive]}
                  disabled={!canControl}
                  onPress={() => setWeaponId(id)}
                >
                  <Icon name={w.icon} size={18} color={active ? '#0A0A0C' : '#fff'} />
                  <Text style={[styles.weaponText, active && styles.weaponTextActive]} allowFontScaling={false}>{w.name}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <Slider label={`Angle ${Math.round(angle)}\u00b0`} value={(angle - 5) / 80} disabled={!canControl} onChange={(v) => setAngle(5 + v * 80)} />
          <Slider label={`Power ${Math.round(power * 100)}%`} value={power} disabled={!canControl} accent onChange={setPower} />

          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.smallBtn} disabled={!canControl} onPress={nextUnit}>
              <Icon name="people" size={18} color="#fff" />
              <Text style={styles.smallBtnText} allowFontScaling={false}>Next</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.fireBtn, !canControl && styles.fireBtnDisabled]}
              disabled={!canControl}
              onPress={fire}
            >
              <Icon name="flame" size={20} color="#0A0A0C" />
              <Text style={styles.fireText} allowFontScaling={false}>{submitting ? 'Firing…' : 'FIRE'}</Text>
            </TouchableOpacity>
            <View style={styles.smallBtn} />
          </View>
        </View>
      ) : (
        <View style={styles.spectatorBar}>
          <Icon name="eye" size={16} color={TEAL} />
          <Text style={styles.spectatorText} allowFontScaling={false}>
            Watching — send a Revive 🛟 to bring a creator's unit back
          </Text>
        </View>
      )}
    </View>
  );
}

function Slider({ label, value, onChange, accent, disabled }) {
  const [w, setW] = useState(1);
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !disabled,
      onMoveShouldSetPanResponder: () => !disabled,
      onPanResponderGrant: (e) => onChange(clampNum(e.nativeEvent.locationX / w, 0, 1)),
      onPanResponderMove: (e) => onChange(clampNum(e.nativeEvent.locationX / w, 0, 1)),
    })
  ).current;
  return (
    <View style={styles.sliderWrap}>
      <Text style={styles.sliderLabel} allowFontScaling={false}>{label}</Text>
      <View
        style={[styles.sliderTrack, disabled && { opacity: 0.4 }]}
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
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingTop: 8, paddingBottom: 6 },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  turnPill: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.08)', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20 },
  turnDot: { width: 9, height: 9, borderRadius: 5 },
  turnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  windPill: { flexDirection: 'row', alignItems: 'center', gap: 4, minWidth: 56, justifyContent: 'flex-end' },
  windText: { color: '#A1A1AA', fontWeight: '600', fontSize: 13 },
  livesRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 14, paddingBottom: 4 },
  livesGroup: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  livesName: { fontWeight: '800', fontSize: 12, marginRight: 4 },
  lifeDot: { width: 8, height: 8, borderRadius: 4 },
  stage: { width: '100%', flex: 1, overflow: 'hidden' },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: '#A1A1AA', fontWeight: '600' },
  controls: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 24, gap: 10 },
  waitText: { color: '#A1A1AA', fontWeight: '600', fontSize: 12, textAlign: 'center' },
  weaponRow: { flexDirection: 'row', gap: 8, paddingRight: 8 },
  weaponBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 9, paddingHorizontal: 16, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  weaponBtnActive: { backgroundColor: TEAL, borderColor: TEAL },
  weaponText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  weaponTextActive: { color: '#0A0A0C' },
  sliderWrap: { gap: 5 },
  sliderLabel: { color: '#A1A1AA', fontWeight: '600', fontSize: 12 },
  sliderTrack: { height: 24, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.08)', justifyContent: 'center' },
  sliderFill: { position: 'absolute', left: 0, height: 24, borderRadius: 12 },
  sliderThumb: { position: 'absolute', width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff', marginLeft: -9 },
  actionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 2 },
  smallBtn: { width: 56, alignItems: 'center', justifyContent: 'center', gap: 2 },
  smallBtnText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  fireBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: TEAL, paddingVertical: 15, borderRadius: 30 },
  fireBtnDisabled: { opacity: 0.4 },
  fireText: { color: '#0A0A0C', fontWeight: '800', fontSize: 16 },
  spectatorBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, paddingHorizontal: 16 },
  spectatorText: { color: '#D4D4D8', fontWeight: '600', fontSize: 12 },
});
