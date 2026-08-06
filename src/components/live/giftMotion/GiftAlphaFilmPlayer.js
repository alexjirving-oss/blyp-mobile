/**
 * GiftAlphaFilmPlayer — true soft-edge gift overlay via RGB|Alpha split MP4.
 *
 * Android (and iOS) ExoPlayer/AVPlayer do not composite per-pixel alpha from
 * stock H.264. We decode a YYEVA-style side-by-side MP4 (RGB left | Alpha right)
 * inside a transparent WebView and recombine on a canvas each frame.
 *
 * Drop-in assets: assets/gifts/cinema/alpha/{id}.mp4
 * Fallback: dark-key clips via GiftFilmPlayer when alpha module missing.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Dimensions,
  Platform,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { Asset } from 'expo-asset';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import {
  getFxBudget,
  getTierConfig,
  playGiftAudio,
  TEAL,
  TEAL_LIGHT,
  GOLD,
} from './giftMotionSystem';
import { resolveAlphaClip, resolveFilmClip } from './filmClipRegistry';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

function senderLabel(sender) {
  const handle = sender?.handle;
  if (typeof handle === 'string' && handle.trim()) {
    return handle.startsWith('@') ? handle : `@${handle}`;
  }
  return 'Someone';
}

function receiverLabel(receiver) {
  const handle = receiver?.handle;
  if (typeof handle === 'string' && handle.trim()) {
    return handle.startsWith('@') ? handle : `@${handle}`;
  }
  return 'host';
}

function fireImpactHaptic(heavy) {
  try {
    Haptics.impactAsync(
      heavy ? Haptics.ImpactFeedbackStyle.Heavy : Haptics.ImpactFeedbackStyle.Medium
    );
  } catch {
    // best-effort
  }
}

function fireAftershock() {
  try {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  } catch {
    // best-effort
  }
}

function buildAlphaHtml(videoUri, durationMs) {
  // YYEVA layout: left = RGB, right = grayscale alpha. WebGL recombines to RGBA.
  const safeUri = String(videoUri || '').replace(/\\/g, '/').replace(/'/g, '%27');
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"/>
<style>
  html, body { margin:0; padding:0; width:100%; height:100%; background:transparent!important; overflow:hidden; }
  #c { position:absolute; inset:0; width:100%; height:100%; background:transparent; }
  video { position:absolute; width:1px; height:1px; opacity:0; pointer-events:none; }
</style>
</head>
<body>
<video id="v" playsinline webkit-playsinline muted autoplay preload="auto" src="${safeUri}"></video>
<canvas id="c"></canvas>
<script>
(function () {
  var v = document.getElementById('v');
  var c = document.getElementById('c');
  var gl = c.getContext('webgl', { alpha: true, premultipliedAlpha: false, antialias: false });
  var doneSent = false;
  var durationMs = ${Number(durationMs) || 3200};

  function post(type, payload) {
    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify(Object.assign({ type: type }, payload || {})));
      }
    } catch (e) {}
  }

  if (!gl) { post('error', { why: 'webgl' }); return; }

  function compile(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  }

  var vs = compile(gl.VERTEX_SHADER, [
    'attribute vec2 aPos;',
    'attribute vec2 aUv;',
    'varying vec2 vUv;',
    'void main(){',
    '  vUv=aUv;',
    '  gl_Position=vec4(aPos,0.0,1.0);',
    '}'
  ].join('\\n'));
  var fs = compile(gl.FRAGMENT_SHADER, [
    'precision mediump float;',
    'varying vec2 vUv;',
    'uniform sampler2D uTex;',
    'void main(){',
    '  vec2 rgbUv=vec2(vUv.x*0.5,vUv.y);',
    '  vec2 aUv=vec2(0.5+vUv.x*0.5,vUv.y);',
    '  vec4 rgb=texture2D(uTex,rgbUv);',
    '  float a=texture2D(uTex,aUv).r;',
    '  gl_FragColor=vec4(rgb.rgb,a);',
    '}'
  ].join('\\n'));
  var prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.useProgram(prog);

  var buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  // pos.xy, uv.xy — full screen quad, uv 0..1 over RGB subject (cover applied in JS via viewport crop)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1,-1, 0,1,  1,-1, 1,1,  -1,1, 0,0,
    -1,1, 0,0,  1,-1, 1,1,  1,1, 1,0
  ]), gl.STATIC_DRAW);
  var aPos = gl.getAttribLocation(prog, 'aPos');
  var aUv = gl.getAttribLocation(prog, 'aUv');
  gl.enableVertexAttribArray(aPos);
  gl.enableVertexAttribArray(aUv);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
  gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 16, 8);
  gl.uniform1i(gl.getUniformLocation(prog, 'uTex'), 0);

  var tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.floor(window.innerWidth * dpr);
    c.height = Math.floor(window.innerHeight * dpr);
    c.style.width = window.innerWidth + 'px';
    c.style.height = window.innerHeight + 'px';
    gl.viewport(0, 0, c.width, c.height);
  }
  resize();
  window.addEventListener('resize', resize);

  // Cover UV crop against RGB half aspect
  function updateCoverUv() {
    var vw = v.videoWidth / 2;
    var vh = v.videoHeight;
    if (!vw || !vh) return;
    var canvasAspect = window.innerWidth / window.innerHeight;
    var videoAspect = vw / vh;
    var u0 = 0, u1 = 1, v0 = 0, v1 = 1;
    if (videoAspect > canvasAspect) {
      var du = 1 - canvasAspect / videoAspect;
      u0 = du / 2; u1 = 1 - du / 2;
    } else {
      var dv = 1 - videoAspect / canvasAspect;
      v0 = dv / 2; v1 = 1 - dv / 2;
    }
    // Flip V for video texture orientation
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1,-1, u0,v1,  1,-1, u1,v1,  -1,1, u0,v0,
      -1,1, u0,v0,  1,-1, u1,v1,  1,1, u1,v0
    ]), gl.STATIC_DRAW);
  }

  function draw() {
    if (v.readyState >= 2) {
      updateCoverUv();
      gl.clearColor(0,0,0,0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, v);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      } catch (e) {}
    }
    requestAnimationFrame(draw);
  }

  v.addEventListener('loadeddata', function () {
    post('ready', { w: v.videoWidth, h: v.videoHeight });
    v.play().catch(function () {});
    requestAnimationFrame(draw);
  });
  v.addEventListener('ended', function () {
    if (doneSent) return;
    doneSent = true;
    post('ended', {});
  });
  v.addEventListener('error', function () { post('error', {}); });
  setTimeout(function () {
    if (!doneSent) { doneSent = true; post('ended', { reason: 'timeout' }); }
  }, durationMs + 900);
})();
</script>
</body>
</html>`;
}

/**
 * Props mirror GiftFilmPlayer.
 */
export default function GiftAlphaFilmPlayer({ entry, onSkip, onDone, film: filmProp }) {
  const budget = useMemo(() => getFxBudget(), []);
  const chrome = useSharedValue(0);
  const plaqueProg = useSharedValue(0);
  const impactFlash = useSharedValue(0);
  const glowPulse = useSharedValue(0.55);
  const skippedRef = useRef(false);
  const impactFiredRef = useRef(false);
  const aftershockFiredRef = useRef(false);
  const finishedRef = useRef(false);
  const gloryTimerRef = useRef(null);
  const doneTimerRef = useRef(null);
  const impactTimerRef = useRef(null);
  const afterTimerRef = useRef(null);
  const [inGlory, setInGlory] = useState(false);
  const [videoUri, setVideoUri] = useState(null);
  const [loadError, setLoadError] = useState(false);

  const motion = entry?.motion;
  const alpha = filmProp || resolveAlphaClip(motion);
  const darkFallback = resolveFilmClip(motion);
  const tier = getTierConfig(motion?.motionTier);
  const palette = motion?.palette || [TEAL, TEAL_LIGHT, GOLD];
  const heavy =
    motion?.motionTier === 'legendary' || motion?.motionTier === 'ultimate';
  const meta = alpha?.meta || darkFallback?.meta;
  const durationMs = meta?.durationMs || 3200;
  const gloryMs = meta?.gloryMs || 1000;
  const impactAt = typeof meta?.impactAt === 'number' ? meta.impactAt : 0.3;
  const stageScale = tier.takeover === 'spotlight' ? 0.88 : 1.0;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!alpha?.module) {
          setLoadError(true);
          return;
        }
        const asset = Asset.fromModule(alpha.module);
        await asset.downloadAsync();
        if (cancelled) return;
        const uri = asset.localUri || asset.uri;
        if (!uri) {
          setLoadError(true);
          return;
        }
        setVideoUri(uri);
      } catch {
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [alpha?.module]);

  const finish = (reason) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    if (gloryTimerRef.current) clearTimeout(gloryTimerRef.current);
    if (doneTimerRef.current) clearTimeout(doneTimerRef.current);
    chrome.value = withTiming(0, { duration: 220 });
    plaqueProg.value = withTiming(0, { duration: 180 });
    impactFlash.value = withTiming(0, { duration: 120 });
    setTimeout(() => onDone?.(reason), 200);
  };

  const enterGloryHold = () => {
    if (skippedRef.current || finishedRef.current || inGlory) return;
    setInGlory(true);
    plaqueProg.value = withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) });
    gloryTimerRef.current = setTimeout(() => {
      if (!skippedRef.current) finish('complete');
    }, gloryMs);
  };

  const skipNow = () => {
    if (skippedRef.current || finishedRef.current) return;
    skippedRef.current = true;
    cancelAnimation(chrome);
    cancelAnimation(plaqueProg);
    cancelAnimation(impactFlash);
    chrome.value = withTiming(0, { duration: 160 });
    finish('skip');
  };

  useEffect(() => {
    if (!entry || !motion || (!alpha?.module && !darkFallback?.source)) return undefined;

    skippedRef.current = false;
    finishedRef.current = false;
    impactFiredRef.current = false;
    aftershockFiredRef.current = false;
    setInGlory(false);
    chrome.value = 0;
    plaqueProg.value = 0;
    impactFlash.value = 0;
    glowPulse.value = 0.55;

    playGiftAudio(motion.audioKey);
    chrome.value = withTiming(1, { duration: 220, easing: Easing.out(Easing.cubic) });
    plaqueProg.value = withTiming(1, {
      duration: 380,
      easing: Easing.out(Easing.cubic),
    });
    glowPulse.value = withSequence(
      withTiming(1, {
        duration: Math.round(durationMs * impactAt),
        easing: Easing.out(Easing.cubic),
      }),
      withTiming(0.7, { duration: 400 })
    );

    const impactMs = Math.round(durationMs * impactAt);
    impactTimerRef.current = setTimeout(() => {
      if (skippedRef.current || impactFiredRef.current) return;
      impactFiredRef.current = true;
      fireImpactHaptic(heavy);
      impactFlash.value = withSequence(
        withTiming(1, { duration: 70, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: 320, easing: Easing.in(Easing.cubic) })
      );
    }, impactMs);

    if (motion.motionTier === 'ultimate' || motion.motionTier === 'legendary') {
      afterTimerRef.current = setTimeout(() => {
        if (skippedRef.current || aftershockFiredRef.current) return;
        aftershockFiredRef.current = true;
        fireAftershock();
      }, Math.round(durationMs * Math.min(0.62, impactAt + 0.22)));
    }

    doneTimerRef.current = setTimeout(() => {
      if (!skippedRef.current && !finishedRef.current) finish('timeout');
    }, durationMs + gloryMs + 800);

    return () => {
      if (impactTimerRef.current) clearTimeout(impactTimerRef.current);
      if (afterTimerRef.current) clearTimeout(afterTimerRef.current);
      if (gloryTimerRef.current) clearTimeout(gloryTimerRef.current);
      if (doneTimerRef.current) clearTimeout(doneTimerRef.current);
      cancelAnimation(chrome);
      cancelAnimation(plaqueProg);
      cancelAnimation(impactFlash);
      cancelAnimation(glowPulse);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry]);

  const onWebMessage = (event) => {
    try {
      const data = JSON.parse(event?.nativeEvent?.data || '{}');
      if (data.type === 'ended') enterGloryHold();
      if (data.type === 'error') setLoadError(true);
    } catch {
      // ignore
    }
  };

  const vignetteStyle = useAnimatedStyle(() => ({
    opacity: chrome.value * (tier.takeover === 'spotlight' ? 0.22 : 0.32),
  }));

  const plaqueStyle = useAnimatedStyle(() => ({
    opacity: plaqueProg.value * chrome.value,
    transform: [
      { translateY: (1 - plaqueProg.value) * 16 },
      { scale: 0.96 + plaqueProg.value * 0.04 },
    ],
  }));

  const skipHintStyle = useAnimatedStyle(() => ({
    opacity: chrome.value * 0.55 * (inGlory ? 0.35 : 1),
  }));

  const stageStyle = useAnimatedStyle(() => ({
    opacity: chrome.value,
    transform: [{ scale: (0.92 + chrome.value * 0.08) * stageScale }],
  }));

  const glowStyle = useAnimatedStyle(() => ({
    opacity: chrome.value * glowPulse.value * (budget.bloom ? 0.75 : 0.45),
    transform: [{ scale: 0.85 + glowPulse.value * 0.25 }],
  }));

  const flashStyle = useAnimatedStyle(() => ({
    opacity: impactFlash.value * 0.65,
  }));

  if (!entry || !motion) return null;

  // If alpha failed to resolve/load, parent should have preferred dark-key path.
  // Still render chrome so we never soft-lock the live room.
  const html = videoUri ? buildAlphaHtml(videoUri, durationMs) : null;
  const stageH = tier.takeover === 'spotlight' ? SCREEN_H * 0.62 : SCREEN_H;

  return (
    <View
      style={[styles.root, tier.takeover === 'spotlight' ? styles.spotlightRoot : null]}
      pointerEvents="box-none"
    >
      <Animated.View style={[styles.vignette, vignetteStyle]} pointerEvents="none">
        <LinearGradient
          colors={['rgba(0,0,0,0.08)', 'rgba(2,8,14,0.38)', 'rgba(0,0,0,0.22)']}
          locations={[0, 0.55, 1]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>

      <Animated.View
        style={[styles.glowPlate, { backgroundColor: palette[1] || TEAL }, glowStyle]}
        pointerEvents="none"
      />

      <Animated.View
        style={[
          styles.stage,
          tier.takeover === 'spotlight' ? styles.spotlightStage : styles.fullStage,
          { height: stageH },
          stageStyle,
        ]}
        pointerEvents="none"
      >
        {html && !loadError ? (
          <WebView
            source={{ html }}
            style={styles.webview}
            originWhitelist={['*']}
            allowFileAccess
            allowUniversalAccessFromFileURLs
            mixedContentMode="always"
            mediaPlaybackRequiresUserAction={false}
            allowsInlineMediaPlayback
            javaScriptEnabled
            domStorageEnabled
            scrollEnabled={false}
            bounces={false}
            overScrollMode="never"
            setSupportMultipleWindows={false}
            onMessage={onWebMessage}
            androidLayerType={Platform.OS === 'android' ? 'hardware' : undefined}
            containerStyle={styles.webviewContainer}
          />
        ) : null}
      </Animated.View>

      <Animated.View style={[styles.impactFlash, flashStyle]} pointerEvents="none">
        <LinearGradient
          colors={['rgba(255,255,255,0.9)', 'rgba(253,224,71,0.5)', 'rgba(255,255,255,0)']}
          start={{ x: 0.5, y: 0.35 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>

      <Animated.View style={[styles.plaqueWrap, plaqueStyle]} pointerEvents="none">
        <LinearGradient colors={[palette[0], palette[1] || TEAL]} style={styles.plaque}>
          <Text style={styles.plaqueTier}>{String(tier.label || '').toUpperCase()}</Text>
          <Text style={styles.plaqueTitle} numberOfLines={1}>
            {motion.name}
          </Text>
          <Text style={styles.plaqueMeta} numberOfLines={1}>
            {senderLabel(entry.sender)} → {receiverLabel(entry.receiver)}
          </Text>
        </LinearGradient>
      </Animated.View>

      <Animated.Text style={[styles.skipHint, skipHintStyle]}>Tap to skip</Animated.Text>

      <Pressable style={styles.skipHit} onPress={skipNow} accessibilityLabel="Skip gift film" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 3,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  spotlightRoot: {
    justifyContent: 'flex-start',
    paddingTop: SCREEN_H * 0.1,
    backgroundColor: 'transparent',
  },
  vignette: {
    ...StyleSheet.absoluteFillObject,
  },
  glowPlate: {
    position: 'absolute',
    width: SCREEN_W * 1.15,
    height: SCREEN_W * 1.15,
    borderRadius: SCREEN_W,
  },
  stage: {
    width: SCREEN_W,
    overflow: 'hidden',
    backgroundColor: 'transparent',
  },
  fullStage: {
    ...StyleSheet.absoluteFillObject,
  },
  spotlightStage: {
    borderRadius: 24,
    overflow: 'hidden',
    width: SCREEN_W * 0.96,
    alignSelf: 'center',
  },
  webviewContainer: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  impactFlash: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 5,
  },
  plaqueWrap: {
    position: 'absolute',
    bottom: SCREEN_H * 0.12,
    alignItems: 'center',
    zIndex: 6,
  },
  plaque: {
    minWidth: Math.min(280, SCREEN_W * 0.78),
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  plaqueTier: {
    color: 'rgba(11,18,32,0.75)',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 2,
    marginBottom: 2,
  },
  plaqueTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '900',
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  plaqueMeta: {
    marginTop: 2,
    color: 'rgba(255,255,255,0.92)',
    fontSize: 13,
    fontWeight: '700',
  },
  skipHint: {
    position: 'absolute',
    bottom: SCREEN_H * 0.07,
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
    zIndex: 6,
  },
  skipHit: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 4,
  },
});
