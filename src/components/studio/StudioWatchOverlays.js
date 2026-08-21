/**
 * Phone Studio watch overlays. Child owns Firestore
 * `liveStreams/{id}.studioOverlayFeed` — no overlay-feed GET, no likes.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Image, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { db, firebaseEnabled } from '../../config/firebase';
import { snapData } from '../../utils/firestoreSnap';
import {
  clampOverlayBox,
  hasNativeOverlayWidgets,
  parseStudioOverlayFeedNative,
  phoneOverlayAspect,
  phoneWidgetScale,
} from '../../lib/studioOverlayFeedNative';

const TEAL = '#FF2D55';

function OverlayItem({ pos, layer, children, style }) {
  const [box, setBox] = useState(null);
  const s = phoneWidgetScale(pos.scale);
  const { left, top } = clampOverlayBox(
    pos.x,
    pos.y,
    box ? box.w * s : 0,
    box ? box.h * s : 0,
    layer.w,
    layer.h,
  );
  return (
    <View
      pointerEvents="none"
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        if (!(width > 0 && height > 0)) return;
        setBox((prev) => (prev && prev.w === width && prev.h === height ? prev : { w: width, h: height }));
      }}
      style={[
        styles.card,
        style,
        {
          left,
          top,
          opacity: box ? 1 : 0,
          transform: [{ scale: s }],
          transformOrigin: 'top left',
        },
      ]}
    >
      {children}
    </View>
  );
}

function jukeboxCopy(feed) {
  const now = feed.jukeboxNow || '';
  const nowParts = now.includes('\u2014') ? now.split(' \u2014 ') : [now];
  const queuedOnly =
    !feed.jukeboxTitle &&
    (!now || now === 'Queue empty' || now.startsWith('Up next'));
  const title = queuedOnly
    ? 'Nothing playing'
    : feed.jukeboxTitle || nowParts[0] || 'Nothing playing';
  const artist = queuedOnly ? '' : feed.jukeboxArtist || nowParts.slice(1).join(' \u2014 ');
  return { title, artist, next: feed.jukeboxNext || '', art: feed.jukeboxArt };
}

export default function StudioWatchOverlays({ streamId, topInset = 0, bottomInset = 0 }) {
  const { width: winW, height: winH } = useWindowDimensions();
  const aspect = phoneOverlayAspect(winW, winH);
  const [rawFeed, setRawFeed] = useState(null);
  const [layer, setLayer] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const id = String(streamId || '').trim();
    if (!id || !firebaseEnabled || !db?.collection) {
      setRawFeed(null);
      return undefined;
    }
    const unsub = db.collection('liveStreams').doc(id).onSnapshot(
      (snap) => {
        const data = snapData(snap);
        const field = data?.studioOverlayFeed;
        const next = field && typeof field === 'object' ? field : null;
        setRawFeed((prev) => {
          if (prev === next) return prev;
          try {
            if (prev && next && JSON.stringify(prev) === JSON.stringify(next)) return prev;
          } catch {
            /* fall through */
          }
          return next;
        });
      },
      () => setRawFeed(null),
    );
    return () => {
      try {
        unsub();
      } catch {
        /* already dropped */
      }
    };
  }, [streamId]);

  const feed = useMemo(
    () => parseStudioOverlayFeedNative(rawFeed, { aspect }),
    [rawFeed, aspect],
  );
  const copy = useMemo(() => (feed ? jukeboxCopy(feed) : null), [feed]);
  const ready = layer.w > 1 && layer.h > 1;

  if (!feed || !hasNativeOverlayWidgets(feed)) return null;

  return (
    <View
      pointerEvents="none"
      style={[styles.layer, { top: topInset, bottom: bottomInset, opacity: ready ? 1 : 0 }]}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        if (width > 0 && height > 0) {
          setLayer((prev) => (prev.w === width && prev.h === height ? prev : { w: width, h: height }));
        }
      }}
    >
      {ready && feed.overlays.gifters ? (
        <OverlayItem pos={feed.positions.gifters} layer={layer} style={styles.gifters}>
          <Text style={styles.title} allowFontScaling={false}>
            Top gifters
          </Text>
          {(feed.gifters.length ? feed.gifters : ['Waiting…']).map((g, i) => (
            <Text key={`${g}-${i}`} style={styles.row} numberOfLines={1} allowFontScaling={false}>
              {i + 1}. {g}
            </Text>
          ))}
        </OverlayItem>
      ) : null}

      {ready && feed.overlays.goal ? (
        <OverlayItem pos={feed.positions.goal} layer={layer} style={styles.goal}>
          <Text style={styles.title} numberOfLines={1} allowFontScaling={false}>
            {feed.goalLabel}
          </Text>
          <View style={styles.barTrack}>
            <View style={[styles.barFill, { width: `${feed.goalPct}%` }]} />
          </View>
        </OverlayItem>
      ) : null}

      {ready && feed.overlays.jukebox && copy ? (
        <OverlayItem pos={feed.positions.jukebox} layer={layer} style={styles.jukebox}>
          <View style={styles.jbxRow}>
            {copy.art ? (
              <Image source={{ uri: copy.art }} style={styles.jbxArt} />
            ) : (
              <View style={[styles.jbxArt, styles.jbxArtEmpty]} />
            )}
            <View style={styles.jbxCopy}>
              <Text style={styles.kicker} allowFontScaling={false}>
                Now playing
              </Text>
              <Text style={styles.jbxTitle} numberOfLines={1} allowFontScaling={false}>
                {copy.title}
              </Text>
              {copy.artist ? (
                <Text style={styles.jbxArtist} numberOfLines={1} allowFontScaling={false}>
                  {copy.artist}
                </Text>
              ) : null}
            </View>
          </View>
          {copy.next ? (
            <Text style={styles.jbxNext} numberOfLines={1} allowFontScaling={false}>
              {`Up next \u00B7 ${copy.next}`}
            </Text>
          ) : null}
        </OverlayItem>
      ) : null}

      {ready && feed.overlays.events ? (
        <OverlayItem pos={feed.positions.events} layer={layer} style={styles.events}>
          <Text style={styles.title} allowFontScaling={false}>
            Recent
          </Text>
          {feed.events.length === 0 ? (
            <Text style={styles.row} allowFontScaling={false}>
              Waiting for events…
            </Text>
          ) : (
            feed.events.slice(0, 4).map((ev) => (
              <Text key={ev.id} style={styles.row} numberOfLines={2} allowFontScaling={false}>
                {ev.text}
              </Text>
            ))
          )}
        </OverlayItem>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    left: 8,
    right: 8,
    zIndex: 35,
    elevation: 30,
    pointerEvents: 'none',
    overflow: 'hidden',
  },
  card: {
    position: 'absolute',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(8, 10, 14, 0.78)',
    borderWidth: 1,
    borderColor: 'rgba(255, 45, 85, 0.38)',
  },
  title: {
    color: TEAL,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  row: {
    color: 'rgba(244, 247, 251, 0.78)',
    marginTop: 2,
    fontSize: 11,
    fontWeight: '600',
    maxWidth: 148,
  },
  gifters: {
    width: 132,
  },
  goal: {
    width: 168,
  },
  barTrack: {
    marginTop: 5,
    height: 5,
    borderRadius: 99,
    backgroundColor: '#1a1a22',
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    backgroundColor: TEAL,
    borderRadius: 99,
  },
  jukebox: {
    width: 188,
    backgroundColor: 'rgba(42, 24, 14, 0.88)',
    borderColor: 'rgba(240, 200, 120, 0.42)',
  },
  jbxRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  jbxArt: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  jbxArtEmpty: {
    borderWidth: 1,
    borderColor: 'rgba(240, 200, 120, 0.35)',
  },
  jbxCopy: {
    flexShrink: 1,
    marginLeft: 8,
    minWidth: 0,
  },
  kicker: {
    color: '#ffb14a',
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  jbxTitle: {
    color: '#fff4d6',
    fontSize: 13,
    fontWeight: '800',
  },
  jbxArtist: {
    color: 'rgba(255, 244, 214, 0.75)',
    fontSize: 11,
    fontWeight: '600',
  },
  jbxNext: {
    marginTop: 4,
    color: 'rgba(255, 244, 214, 0.7)',
    fontSize: 10,
    fontWeight: '600',
  },
  events: {
    width: 156,
  },
});
