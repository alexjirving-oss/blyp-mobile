import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import { COLORS } from '../styles/theme';
import {
  getSpotifyLinkStatus,
  getSpotifyPlaybackState,
  getSpotifyRedirectUri,
  isSpotifyConnectConfigured,
  linkSpotifyAccount,
  pauseSpotifyPlayback,
  resumeSpotifyPlayback,
  spotifyConnectSetupHint,
  unlinkSpotifyAccount,
} from '../services/spotifyConnectService';

/**
 * Model A — link the user's Spotify Premium and control background playback
 * while they use Blyp. Does not host or resell Spotify catalog.
 */
export default function SpotifyConnectScreen({ navigation }) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState({ linked: false, configured: false });
  const [nowPlaying, setNowPlaying] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await getSpotifyLinkStatus();
      setStatus(next);
      if (next.linked) {
        const player = await getSpotifyPlaybackState().catch(() => null);
        setNowPlaying(player);
      } else {
        setNowPlaying(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const onLink = async () => {
    if (!isSpotifyConnectConfigured()) {
      Alert.alert('Spotify setup needed', spotifyConnectSetupHint());
      return;
    }
    setBusy(true);
    try {
      await linkSpotifyAccount();
      await refresh();
      Alert.alert('Spotify linked', 'Keep Spotify running in the background while you use Blyp.');
    } catch (e) {
      if (!/cancel/i.test(String(e?.message || ''))) {
        Alert.alert('Could not link Spotify', e?.message || 'Try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  const onUnlink = () => {
    Alert.alert('Unlink Spotify?', 'Blyp will stop controlling your Spotify playback.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unlink',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await unlinkSpotifyAccount();
            await refresh();
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  const onPause = async () => {
    setBusy(true);
    try {
      await pauseSpotifyPlayback();
      await refresh();
    } catch (e) {
      Alert.alert('Pause failed', e?.message || 'Try again.');
    } finally {
      setBusy(false);
    }
  };

  const onResume = async () => {
    setBusy(true);
    try {
      await resumeSpotifyPlayback();
      await refresh();
    } catch (e) {
      Alert.alert('Resume failed', e?.message || 'Open Spotify once, then retry.');
    } finally {
      setBusy(false);
    }
  };

  const trackName =
    nowPlaying?.item?.name ||
    nowPlaying?.item?.show?.name ||
    null;
  const artist =
    nowPlaying?.item?.artists?.map?.((a) => a.name).filter(Boolean).join(', ') ||
    null;

  return (
    <ScreenContainer>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation?.goBack?.()} hitSlop={12}>
          <Text style={styles.back}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Spotify Connect</Text>
        <View style={{ width: 48 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.lead}>
          Link your Spotify Premium account to keep listening in the background while you browse Blyp.
          Blyp pauses Spotify when you unmute For You, join live, or take a call.
        </Text>

        {loading ? (
          <ActivityIndicator color={COLORS.primary} style={{ marginTop: 24 }} />
        ) : (
          <>
            <View style={styles.card}>
              <Text style={styles.label}>STATUS</Text>
              <Text style={styles.value}>
                {!status.configured
                  ? 'Client ID not in this build'
                  : status.linked
                    ? `Linked${status.displayName ? ` · ${status.displayName}` : ''}`
                    : 'Not linked'}
              </Text>
              {status.product ? (
                <Text style={styles.meta}>Plan: {status.product}</Text>
              ) : null}
              {trackName ? (
                <Text style={styles.meta} numberOfLines={2}>
                  Now: {trackName}
                  {artist ? ` — ${artist}` : ''}
                  {nowPlaying?.is_playing ? ' · playing' : ' · paused'}
                </Text>
              ) : null}
            </View>

            {!status.linked ? (
              <TouchableOpacity
                style={[styles.primaryBtn, busy && styles.disabled]}
                disabled={busy}
                onPress={onLink}
              >
                <Text style={styles.primaryText}>
                  {status.configured ? 'Link Spotify' : 'View setup steps'}
                </Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.row}>
                <TouchableOpacity
                  style={[styles.secondaryBtn, busy && styles.disabled]}
                  disabled={busy}
                  onPress={onPause}
                >
                  <Text style={styles.secondaryText}>Pause</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.primaryBtn, styles.flex, busy && styles.disabled]}
                  disabled={busy}
                  onPress={onResume}
                >
                  <Text style={styles.primaryText}>Resume</Text>
                </TouchableOpacity>
              </View>
            )}

            {status.linked ? (
              <TouchableOpacity style={styles.linkBtn} disabled={busy} onPress={onUnlink}>
                <Text style={styles.linkText}>Unlink Spotify</Text>
              </TouchableOpacity>
            ) : null}

            <Text style={styles.hintTitle}>Developer Dashboard</Text>
            <Text style={styles.hint}>
              Redirect URI for this build:{'\n'}
              {getSpotifyRedirectUri()}
            </Text>
            <Text style={styles.hint}>{spotifyConnectSetupHint()}</Text>
          </>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  back: { color: COLORS.primary, fontSize: 16, fontWeight: '600', width: 48 },
  title: { color: '#fff', fontSize: 17, fontWeight: '700' },
  body: { padding: 16, paddingBottom: 48 },
  lead: { color: '#A1A1AA', fontSize: 14, lineHeight: 20, marginBottom: 18 },
  card: {
    backgroundColor: '#141418',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginBottom: 16,
  },
  label: { color: '#71717A', fontSize: 11, fontWeight: '700', letterSpacing: 0.6 },
  value: { color: '#fff', fontSize: 18, fontWeight: '700', marginTop: 6 },
  meta: { color: '#A1A1AA', fontSize: 13, marginTop: 8 },
  primaryBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  secondaryBtn: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    marginRight: 10,
  },
  secondaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  linkBtn: { marginTop: 18, alignItems: 'center' },
  linkText: { color: '#F87171', fontSize: 14, fontWeight: '600' },
  hintTitle: { color: '#fff', fontSize: 14, fontWeight: '700', marginTop: 28, marginBottom: 8 },
  hint: { color: '#71717A', fontSize: 12, lineHeight: 18, marginBottom: 10 },
  disabled: { opacity: 0.55 },
});
